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

  -- Global bot settings (key-value store)
  CREATE TABLE IF NOT EXISTS settings (
    key        TEXT PRIMARY KEY,
    value      TEXT NOT NULL,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  -- Eslite exhibition restock tracking
  CREATE TABLE IF NOT EXISTS eslite_subscriptions (
    id             INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id        TEXT NOT NULL,
    target_id      TEXT NOT NULL,
    target_type    TEXT NOT NULL CHECK(target_type IN ('channel', 'dm')),
    exhibition_id  TEXT NOT NULL,
    created_at     DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  CREATE INDEX IF NOT EXISTS idx_eslite_subs_exhibition ON eslite_subscriptions(exhibition_id);
  CREATE INDEX IF NOT EXISTS idx_eslite_subs_user       ON eslite_subscriptions(user_id);

  CREATE TABLE IF NOT EXISTS eslite_snapshots (
    exhibition_id TEXT PRIMARY KEY,
    snapshot_json TEXT NOT NULL,
    updated_at    DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  -- Momo category restock tracking
  CREATE TABLE IF NOT EXISTS momo_subscriptions (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id      TEXT NOT NULL,
    target_id    TEXT NOT NULL,
    target_type  TEXT NOT NULL CHECK(target_type IN ('channel', 'dm')),
    category_url TEXT NOT NULL,
    created_at   DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  CREATE INDEX IF NOT EXISTS idx_momo_subs_category ON momo_subscriptions(category_url);
  CREATE INDEX IF NOT EXISTS idx_momo_subs_user     ON momo_subscriptions(user_id);

  CREATE TABLE IF NOT EXISTS momo_snapshots (
    category_url  TEXT PRIMARY KEY,
    snapshot_json TEXT NOT NULL,
    updated_at    DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  -- Shopee restock & search tracking
  CREATE TABLE IF NOT EXISTS shopee_subscriptions (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id      TEXT NOT NULL,
    target_id    TEXT NOT NULL,
    target_type  TEXT NOT NULL CHECK(target_type IN ('channel', 'dm')),
    search_url   TEXT NOT NULL,
    keyword      TEXT,
    shop_id      TEXT,
    created_at   DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  CREATE INDEX IF NOT EXISTS idx_shopee_subs_url  ON shopee_subscriptions(search_url);
  CREATE INDEX IF NOT EXISTS idx_shopee_subs_user ON shopee_subscriptions(user_id);

  CREATE TABLE IF NOT EXISTS shopee_snapshots (
    search_url    TEXT PRIMARY KEY,
    snapshot_json TEXT NOT NULL,
    updated_at    DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  -- Auto-buy: encrypted session cookies per user
  CREATE TABLE IF NOT EXISTS autobuy_configs (
    user_id          TEXT PRIMARY KEY,
    encrypted_cookie TEXT NOT NULL,
    iv               TEXT NOT NULL,
    auth_tag         TEXT NOT NULL,
    name             TEXT,
    email            TEXT,
    phone            TEXT,
    seven_store_id   TEXT DEFAULT '962380',
    seven_store_name TEXT DEFAULT '大五股門市',
    seven_store_addr TEXT DEFAULT '大五股門市(新北市五股區成泰路二段81號)',
    created_at       DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at       DATETIME DEFAULT CURRENT_TIMESTAMP
  );
`);

// Safe migration: add new columns to existing DBs
const profileColumns = [
  ['name',             'TEXT'],
  ['email',            'TEXT'],
  ['phone',            'TEXT'],
  ['seven_store_id',   "TEXT DEFAULT '962380'"],
  ['seven_store_name', "TEXT DEFAULT '大五股門市'"],
  ['seven_store_addr', "TEXT DEFAULT '大五股門市(新北市五股區成泰路二段81號)'"],
];
for (const [col, type] of profileColumns) {
  try { db.exec(`ALTER TABLE autobuy_configs ADD COLUMN ${col} ${type}`); } catch (_) {}
}

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

  // ── Settings ─────────────────────────────────────────────────────────────

  getSetting: db.prepare(`
    SELECT value FROM settings WHERE key = @key
  `),

  setSetting: db.prepare(`
    INSERT INTO settings (key, value, updated_at)
    VALUES (@key, @value, CURRENT_TIMESTAMP)
    ON CONFLICT(key) DO UPDATE SET
      value      = excluded.value,
      updated_at = CURRENT_TIMESTAMP
  `),

  getAllSettings: db.prepare(`
    SELECT key, value, updated_at FROM settings ORDER BY key
  `),

  // ── Eslite restock ──────────────────────────────────────────────────────

  addEsliteSubscription: db.prepare(`
    INSERT INTO eslite_subscriptions (user_id, target_id, target_type, exhibition_id)
    VALUES (@user_id, @target_id, @target_type, @exhibition_id)
  `),

  removeEsliteSubscription: db.prepare(`
    DELETE FROM eslite_subscriptions WHERE id = @id AND user_id = @user_id
  `),

  listEsliteByUser: db.prepare(`
    SELECT id, exhibition_id, target_type
    FROM eslite_subscriptions
    WHERE user_id = @user_id AND target_id = @target_id
    ORDER BY id ASC
  `),

  getAllEsliteExhibitions: db.prepare(`
    SELECT DISTINCT exhibition_id FROM eslite_subscriptions
  `),

  getEsliteSubsForExhibition: db.prepare(`
    SELECT id, user_id, target_id, target_type
    FROM eslite_subscriptions
    WHERE exhibition_id = @exhibition_id
  `),

  findEsliteSubscription: db.prepare(`
    SELECT id FROM eslite_subscriptions
    WHERE user_id = @user_id AND target_id = @target_id AND exhibition_id = @exhibition_id
  `),

  getEsliteSnapshot: db.prepare(`
    SELECT snapshot_json FROM eslite_snapshots WHERE exhibition_id = @exhibition_id
  `),

  upsertEsliteSnapshot: db.prepare(`
    INSERT INTO eslite_snapshots (exhibition_id, snapshot_json, updated_at)
    VALUES (@exhibition_id, @snapshot_json, CURRENT_TIMESTAMP)
    ON CONFLICT(exhibition_id) DO UPDATE SET
      snapshot_json = excluded.snapshot_json,
      updated_at    = CURRENT_TIMESTAMP
  `),

  // ── Momo restock ────────────────────────────────────────────────────────

  addMomoSubscription: db.prepare(`
    INSERT INTO momo_subscriptions (user_id, target_id, target_type, category_url)
    VALUES (@user_id, @target_id, @target_type, @category_url)
  `),

  removeMomoSubscription: db.prepare(`
    DELETE FROM momo_subscriptions WHERE id = @id AND user_id = @user_id
  `),

  listMomoByUser: db.prepare(`
    SELECT id, category_url, target_type
    FROM momo_subscriptions
    WHERE user_id = @user_id AND target_id = @target_id
    ORDER BY id ASC
  `),

  getAllMomoCategories: db.prepare(`
    SELECT DISTINCT category_url FROM momo_subscriptions
  `),

  getMomoSubsForCategory: db.prepare(`
    SELECT id, user_id, target_id, target_type
    FROM momo_subscriptions
    WHERE category_url = @category_url
  `),

  findMomoSubscription: db.prepare(`
    SELECT id FROM momo_subscriptions
    WHERE user_id = @user_id AND target_id = @target_id AND category_url = @category_url
  `),

  getMomoSnapshot: db.prepare(`
    SELECT snapshot_json FROM momo_snapshots WHERE category_url = @category_url
  `),

  upsertMomoSnapshot: db.prepare(`
    INSERT INTO momo_snapshots (category_url, snapshot_json, updated_at)
    VALUES (@category_url, @snapshot_json, CURRENT_TIMESTAMP)
    ON CONFLICT(category_url) DO UPDATE SET
      snapshot_json = excluded.snapshot_json,
      updated_at    = CURRENT_TIMESTAMP
  `),

  // ── Shopee restock ───────────────────────────────────────────────────────

  addShopeeSubscription: db.prepare(`
    INSERT INTO shopee_subscriptions (user_id, target_id, target_type, search_url, keyword, shop_id)
    VALUES (@user_id, @target_id, @target_type, @search_url, @keyword, @shop_id)
  `),

  removeShopeeSubscription: db.prepare(`
    DELETE FROM shopee_subscriptions WHERE id = @id AND user_id = @user_id
  `),

  listShopeeByUser: db.prepare(`
    SELECT id, search_url, keyword, shop_id, target_type
    FROM shopee_subscriptions
    WHERE user_id = @user_id AND target_id = @target_id
    ORDER BY id ASC
  `),

  getAllShopeeSearches: db.prepare(`
    SELECT DISTINCT search_url, keyword, shop_id FROM shopee_subscriptions
  `),

  getShopeeSubsForSearch: db.prepare(`
    SELECT id, user_id, target_id, target_type
    FROM shopee_subscriptions
    WHERE search_url = @search_url
  `),

  findShopeeSubscription: db.prepare(`
    SELECT id FROM shopee_subscriptions
    WHERE user_id = @user_id AND target_id = @target_id AND search_url = @search_url
  `),

  getShopeeSnapshot: db.prepare(`
    SELECT snapshot_json FROM shopee_snapshots WHERE search_url = @search_url
  `),

  upsertShopeeSnapshot: db.prepare(`
    INSERT INTO shopee_snapshots (search_url, snapshot_json, updated_at)
    VALUES (@search_url, @snapshot_json, CURRENT_TIMESTAMP)
    ON CONFLICT(search_url) DO UPDATE SET
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

// ─── Settings API ───────────────────────────────────────────────────────────

/**
 * Get a setting value by key. Returns defaultValue if not found.
 * @param {string} key
 * @param {string} [defaultValue]
 * @returns {string|undefined}
 */
function getSetting(key, defaultValue) {
  const row = stmts.getSetting.get({ key });
  return row ? row.value : defaultValue;
}

/**
 * Get a numeric setting value in milliseconds.
 * Key convention: `poll_interval_ms`, `shop_poll_interval_ms`, `eslite_poll_interval_ms`
 * @param {string} key
 * @param {number} envFallback  value from process.env (already parsed)
 * @returns {number}
 */
function getIntervalMs(key, envFallback) {
  const val = getSetting(key);
  if (val !== undefined) {
    const parsed = parseInt(val, 10);
    if (!isNaN(parsed) && parsed > 0) return parsed;
  }
  return envFallback;
}

/**
 * Set a setting value.
 * @param {string} key
 * @param {string} value
 */
function setSetting(key, value) {
  stmts.setSetting.run({ key, value });
}

/**
 * Get all settings as an array of { key, value, updated_at }.
 */
function getAllSettings() {
  return stmts.getAllSettings.all();
}

// ─── Eslite Restock API ─────────────────────────────────────────────────────

/** Add an eslite exhibition restock subscription. */
function addEsliteSubscription(params) {
  const result = stmts.addEsliteSubscription.run(params);
  return result.lastInsertRowid;
}

/** Remove an eslite subscription (only if owned by user_id). */
function removeEsliteSubscription({ id, user_id }) {
  const result = stmts.removeEsliteSubscription.run({ id, user_id });
  return result.changes;
}

/** List all eslite subscriptions for a user in a channel/dm. */
function listEsliteSubscriptions({ user_id, target_id }) {
  return stmts.listEsliteByUser.all({ user_id, target_id });
}

/** Get all distinct exhibition IDs that have at least one subscription. */
function getAllEsliteExhibitions() {
  const rows = stmts.getAllEsliteExhibitions.all();
  return rows.map(r => r.exhibition_id);
}

/** Get all eslite subscriptions for a specific exhibition ID. */
function getEsliteSubsForExhibition(exhibition_id) {
  return stmts.getEsliteSubsForExhibition.all({ exhibition_id });
}

/** Check if an eslite subscription already exists. */
function findEsliteSubscription(params) {
  return stmts.findEsliteSubscription.get(params);
}

/** Get the persisted inventory snapshot for an exhibition (parsed JSON or null). */
function getEsliteSnapshot(exhibition_id) {
  const row = stmts.getEsliteSnapshot.get({ exhibition_id });
  if (!row) return null;
  try { return JSON.parse(row.snapshot_json); } catch { return null; }
}

/** Save/update the inventory snapshot for an exhibition. */
function upsertEsliteSnapshot(exhibition_id, snapshotObj) {
  stmts.upsertEsliteSnapshot.run({
    exhibition_id,
    snapshot_json: JSON.stringify(snapshotObj),
  });
}

// ─── Momo Restock API ──────────────────────────────────────────────────────

/** Add a momo category restock subscription. */
function addMomoSubscription(params) {
  const result = stmts.addMomoSubscription.run(params);
  return result.lastInsertRowid;
}

/** Remove a momo subscription (only if owned by user_id). */
function removeMomoSubscription({ id, user_id }) {
  const result = stmts.removeMomoSubscription.run({ id, user_id });
  return result.changes;
}

/** List all momo subscriptions for a user in a channel/dm. */
function listMomoSubscriptions({ user_id, target_id }) {
  return stmts.listMomoByUser.all({ user_id, target_id });
}

/** Get all distinct momo category URLs that have at least one subscription. */
function getAllMomoCategories() {
  const rows = stmts.getAllMomoCategories.all();
  return rows.map(r => r.category_url);
}

/** Get all momo subscriptions for a specific category URL. */
function getMomoSubsForCategory(category_url) {
  return stmts.getMomoSubsForCategory.all({ category_url });
}

/** Check if a momo subscription already exists. */
function findMomoSubscription(params) {
  return stmts.findMomoSubscription.get(params);
}

/** Get the persisted inventory snapshot for a momo category (parsed JSON or null). */
function getMomoSnapshot(category_url) {
  const row = stmts.getMomoSnapshot.get({ category_url });
  if (!row) return null;
  try { return JSON.parse(row.snapshot_json); } catch { return null; }
}

/** Save/update the inventory snapshot for a momo category. */
function upsertMomoSnapshot(category_url, snapshotObj) {
  stmts.upsertMomoSnapshot.run({
    category_url,
    snapshot_json: JSON.stringify(snapshotObj),
  });
}

// ─── Auto-buy Config API ─────────────────────────────────────────────────────

/**
 * Save or update the encrypted autobuy config for a user.
 * @param {{ user_id: string, encrypted_cookie: string, iv: string, auth_tag: string }} params
 */
function setAutobuyConfig(params) {
  stmts.setAutobuyConfig.run(params);
}

/**
 * Update checkout profile fields for a user.
 * @param {{ user_id, name, email, phone, seven_store_id, seven_store_name, seven_store_addr }} params
 */
function setAutobuyProfile(params) {
  stmts.setAutobuyProfile.run(params);
}

/**
 * Get the encrypted autobuy config for a user.
 * @param {string} user_id
 * @returns {{ encrypted_cookie: string, iv: string, auth_tag: string } | null}
 */
function getAutobuyConfig(user_id) {
  return stmts.getAutobuyConfig.get({ user_id }) || null;
}

/**
 * Delete the autobuy config for a user.
 * @param {string} user_id
 * @returns {number} rows deleted
 */
function deleteAutobuyConfig(user_id) {
  return stmts.deleteAutobuyConfig.run({ user_id }).changes;
}

/**
 * Check if a user has an autobuy config set.
 * @param {string} user_id
 * @returns {boolean}
 */
function hasAutobuyConfig(user_id) {
  return !!stmts.hasAutobuyConfig.get({ user_id });
}

// ─── Shopee Restock API ──────────────────────────────────────────────────────

/** Add a shopee search/shop subscription. */
function addShopeeSubscription(params) {
  const result = stmts.addShopeeSubscription.run(params);
  return result.lastInsertRowid;
}

/** Remove a shopee subscription (only if owned by user_id). */
function removeShopeeSubscription({ id, user_id }) {
  const result = stmts.removeShopeeSubscription.run({ id, user_id });
  return result.changes;
}

/** List all shopee subscriptions for a user in a channel/dm. */
function listShopeeSubscriptions({ user_id, target_id }) {
  return stmts.listShopeeByUser.all({ user_id, target_id });
}

/** Get all distinct shopee search URLs that have at least one subscription. */
function getAllShopeeSearches() {
  return stmts.getAllShopeeSearches.all();
}

/** Get all shopee subscriptions for a specific search URL. */
function getShopeeSubsForSearch(search_url) {
  return stmts.getShopeeSubsForSearch.all({ search_url });
}

/** Check if a shopee subscription already exists. */
function findShopeeSubscription(params) {
  return stmts.findShopeeSubscription.get(params);
}

/** Get the persisted snapshot for a shopee search (parsed JSON or null). */
function getShopeeSnapshot(search_url) {
  const row = stmts.getShopeeSnapshot.get({ search_url });
  if (!row) return null;
  try { return JSON.parse(row.snapshot_json); } catch { return null; }
}

/** Save/update the snapshot for a shopee search. */
function upsertShopeeSnapshot(search_url, snapshotObj) {
  stmts.upsertShopeeSnapshot.run({
    search_url,
    snapshot_json: JSON.stringify(snapshotObj),
  });
}

/**
 * List all subscriptions across all platforms (PTT, Funbox, Momo, Eslite, Shopee) for a user in a channel/DM.
 * @param {{ user_id: string, target_id: string }} params
 */
function getUserAllSubscriptions({ user_id, target_id }) {
  const ptt = stmts.listByUser.all({ user_id, target_id }).map(r => ({ ...r, platform: 'ptt' }));
  const shop = stmts.listShopByUser.all({ user_id, target_id }).map(r => ({ ...r, platform: 'shop' }));
  const momo = stmts.listMomoByUser.all({ user_id, target_id }).map(r => ({ ...r, platform: 'momo' }));
  const eslite = stmts.listEsliteByUser.all({ user_id, target_id }).map(r => ({ ...r, platform: 'eslite' }));
  const shopee = stmts.listShopeeByUser.all({ user_id, target_id }).map(r => ({ ...r, platform: 'shopee' }));

  return [...ptt, ...shop, ...momo, ...eslite, ...shopee];
}

/**
 * Remove a subscription by platform and ID.
 * @param {{ platform: string, id: number, user_id: string }} params
 * @returns {number} number of rows deleted
 */
function removeSubscriptionByPlatform({ platform, id, user_id }) {
  switch (platform) {
    case 'ptt':
      return removeSubscription({ id, user_id });
    case 'shop':
      return removeShopSubscription({ id, user_id });
    case 'momo':
      return removeMomoSubscription({ id, user_id });
    case 'eslite':
      return removeEsliteSubscription({ id, user_id });
    case 'shopee':
      return removeShopeeSubscription({ id, user_id });
    default:
      return 0;
  }
}

module.exports = {
  // settings
  getSetting,
  setSetting,
  getIntervalMs,
  getAllSettings,
  addSubscription,
  removeSubscription,
  listSubscriptions,
  getAllBoards,
  getSubsForBoard,
  getBoardState,
  upsertBoardState,
  findSubscription,
  // unified
  getUserAllSubscriptions,
  removeSubscriptionByPlatform,
  // shop
  addShopSubscription,
  removeShopSubscription,
  listShopSubscriptions,
  getAllShopCategories,
  getShopSubsForCategory,
  findShopSubscription,
  getShopSnapshot,
  upsertShopSnapshot,
  // eslite
  addEsliteSubscription,
  removeEsliteSubscription,
  listEsliteSubscriptions,
  getAllEsliteExhibitions,
  getEsliteSubsForExhibition,
  findEsliteSubscription,
  getEsliteSnapshot,
  upsertEsliteSnapshot,
  // momo
  addMomoSubscription,
  removeMomoSubscription,
  listMomoSubscriptions,
  getAllMomoCategories,
  getMomoSubsForCategory,
  findMomoSubscription,
  getMomoSnapshot,
  upsertMomoSnapshot,
  // shopee
  addShopeeSubscription,
  removeShopeeSubscription,
  listShopeeSubscriptions,
  getAllShopeeSearches,
  getShopeeSubsForSearch,
  findShopeeSubscription,
  getShopeeSnapshot,
  upsertShopeeSnapshot,
};

