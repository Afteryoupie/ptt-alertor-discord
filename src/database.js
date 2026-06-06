'use strict';

const Database = require('better-sqlite3');
const path = require('path');
const fs = require('fs');

// Ensure data directory exists
const DATA_DIR = path.join(__dirname, '..', 'data');
if (!fs.existsSync(DATA_DIR)) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
}

const DB_PATH = path.join(DATA_DIR, 'alertor.db');
const db = new Database(DB_PATH);

// Performance: WAL mode for concurrent read/write and reduced disk I/O
db.pragma('journal_mode = WAL');
db.pragma('synchronous = NORMAL');
db.pragma('foreign_keys = ON');

// Schema initialization
db.exec(`
  CREATE TABLE IF NOT EXISTS subscriptions (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id     TEXT NOT NULL,
    target_id   TEXT NOT NULL,
    target_type TEXT NOT NULL CHECK(target_type IN ('channel', 'dm')),
    board       TEXT NOT NULL COLLATE NOCASE,
    type        TEXT NOT NULL CHECK(type IN ('keyword', 'author')),
    match_value TEXT NOT NULL,
    created_at  DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  CREATE INDEX IF NOT EXISTS idx_subscriptions_board ON subscriptions(board);
  CREATE INDEX IF NOT EXISTS idx_subscriptions_user  ON subscriptions(user_id);

  CREATE TABLE IF NOT EXISTS board_state (
    board    TEXT PRIMARY KEY COLLATE NOCASE,
    last_aid TEXT
  );

  -- Shop restock tracking
  CREATE TABLE IF NOT EXISTS shop_subscriptions (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id      TEXT NOT NULL,
    target_id    TEXT NOT NULL,
    target_type  TEXT NOT NULL CHECK(target_type IN ('channel', 'dm')),
    category_url TEXT NOT NULL,
    created_at   DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  CREATE INDEX IF NOT EXISTS idx_shop_subs_category ON shop_subscriptions(category_url);
  CREATE INDEX IF NOT EXISTS idx_shop_subs_user     ON shop_subscriptions(user_id);

  CREATE TABLE IF NOT EXISTS shop_snapshots (
    category_url TEXT PRIMARY KEY,
    snapshot_json TEXT NOT NULL,
    updated_at   DATETIME DEFAULT CURRENT_TIMESTAMP
  );
`);

// ─── Prepared Statements ────────────────────────────────────────────────────

const stmts = {
  addSubscription: db.prepare(`
    INSERT INTO subscriptions (user_id, target_id, target_type, board, type, match_value)
    VALUES (@user_id, @target_id, @target_type, @board, @type, @match_value)
  `),

  removeSubscription: db.prepare(`
    DELETE FROM subscriptions WHERE id = @id AND user_id = @user_id
  `),

  listByUser: db.prepare(`
    SELECT id, board, type, match_value, target_type
    FROM subscriptions
    WHERE user_id = @user_id AND target_id = @target_id
    ORDER BY id ASC
  `),

  getAllBoards: db.prepare(`
    SELECT DISTINCT board FROM subscriptions
  `),

  getSubsForBoard: db.prepare(`
    SELECT id, user_id, target_id, target_type, type, match_value
    FROM subscriptions
    WHERE board = @board
  `),

  getBoardState: db.prepare(`
    SELECT last_aid FROM board_state WHERE board = @board
  `),

  upsertBoardState: db.prepare(`
    INSERT INTO board_state (board, last_aid)
    VALUES (@board, @last_aid)
    ON CONFLICT(board) DO UPDATE SET last_aid = excluded.last_aid
  `),

  findSubscription: db.prepare(`
    SELECT id FROM subscriptions
    WHERE user_id = @user_id AND target_id = @target_id AND board = @board AND type = @type AND match_value = @match_value
  `),

  // ── Shop restock ──────────────────────────────────────────────────────────

  addShopSubscription: db.prepare(`
    INSERT INTO shop_subscriptions (user_id, target_id, target_type, category_url)
    VALUES (@user_id, @target_id, @target_type, @category_url)
  `),

  removeShopSubscription: db.prepare(`
    DELETE FROM shop_subscriptions WHERE id = @id AND user_id = @user_id
  `),

  listShopByUser: db.prepare(`
    SELECT id, category_url, target_type
    FROM shop_subscriptions
    WHERE user_id = @user_id AND target_id = @target_id
    ORDER BY id ASC
  `),

  getAllShopCategories: db.prepare(`
    SELECT DISTINCT category_url FROM shop_subscriptions
  `),

  getShopSubsForCategory: db.prepare(`
    SELECT id, user_id, target_id, target_type
    FROM shop_subscriptions
    WHERE category_url = @category_url
  `),

  findShopSubscription: db.prepare(`
    SELECT id FROM shop_subscriptions
    WHERE user_id = @user_id AND target_id = @target_id AND category_url = @category_url
  `),

  getShopSnapshot: db.prepare(`
    SELECT snapshot_json FROM shop_snapshots WHERE category_url = @category_url
  `),

  upsertShopSnapshot: db.prepare(`
    INSERT INTO shop_snapshots (category_url, snapshot_json, updated_at)
    VALUES (@category_url, @snapshot_json, CURRENT_TIMESTAMP)
    ON CONFLICT(category_url) DO UPDATE SET
      snapshot_json = excluded.snapshot_json,
      updated_at    = CURRENT_TIMESTAMP
  `),
};

// ─── Public API ─────────────────────────────────────────────────────────────

/**
 * Add a new subscription.
 * @param {object} params
 * @returns {number} new row id
 */
function addSubscription(params) {
  const result = stmts.addSubscription.run(params);
  return result.lastInsertRowid;
}

/**
 * Remove a subscription (only if owned by user_id).
 * @returns {number} number of rows deleted
 */
function removeSubscription({ id, user_id }) {
  const result = stmts.removeSubscription.run({ id, user_id });
  return result.changes;
}

/**
 * List all subscriptions for a user in a channel/dm.
 */
function listSubscriptions({ user_id, target_id }) {
  return stmts.listByUser.all({ user_id, target_id });
}

/**
 * Get all distinct boards that have at least one subscription.
 * @returns {string[]}
 */
function getAllBoards() {
  const rows = stmts.getAllBoards.all();
  return rows.map(r => r.board);
}

/**
 * Get all subscriptions for a specific board.
 */
function getSubsForBoard(board) {
  return stmts.getSubsForBoard.all({ board });
}

/**
 * Get the last seen article ID for a board (null if never seen).
 */
function getBoardState(board) {
  const row = stmts.getBoardState.get({ board });
  return row ? row.last_aid : null;
}

/**
 * Update the last seen article ID for a board.
 */
function upsertBoardState(board, last_aid) {
  stmts.upsertBoardState.run({ board, last_aid });
}

/**
 * Check if a subscription already exists.
 */
function findSubscription(params) {
  return stmts.findSubscription.get(params);
}

// ─── Shop Restock API ────────────────────────────────────────────────────────

/** Add a shop restock subscription. */
function addShopSubscription(params) {
  const result = stmts.addShopSubscription.run(params);
  return result.lastInsertRowid;
}

/** Remove a shop subscription (only if owned by user_id). */
function removeShopSubscription({ id, user_id }) {
  const result = stmts.removeShopSubscription.run({ id, user_id });
  return result.changes;
}

/** List all shop subscriptions for a user in a channel/dm. */
function listShopSubscriptions({ user_id, target_id }) {
  return stmts.listShopByUser.all({ user_id, target_id });
}

/** Get all distinct category URLs that have at least one shop subscription. */
function getAllShopCategories() {
  const rows = stmts.getAllShopCategories.all();
  return rows.map(r => r.category_url);
}

/** Get all shop subscriptions for a specific category URL. */
function getShopSubsForCategory(category_url) {
  return stmts.getShopSubsForCategory.all({ category_url });
}

/** Check if a shop subscription already exists. */
function findShopSubscription(params) {
  return stmts.findShopSubscription.get(params);
}

/** Get the persisted inventory snapshot for a category (parsed JSON or null). */
function getShopSnapshot(category_url) {
  const row = stmts.getShopSnapshot.get({ category_url });
  if (!row) return null;
  try { return JSON.parse(row.snapshot_json); } catch { return null; }
}

/** Save/update the inventory snapshot for a category. */
function upsertShopSnapshot(category_url, snapshotObj) {
  stmts.upsertShopSnapshot.run({
    category_url,
    snapshot_json: JSON.stringify(snapshotObj),
  });
}

module.exports = {
  addSubscription,
  removeSubscription,
  listSubscriptions,
  getAllBoards,
  getSubsForBoard,
  getBoardState,
  upsertBoardState,
  findSubscription,
  // shop
  addShopSubscription,
  removeShopSubscription,
  listShopSubscriptions,
  getAllShopCategories,
  getShopSubsForCategory,
  findShopSubscription,
  getShopSnapshot,
  upsertShopSnapshot,
};
