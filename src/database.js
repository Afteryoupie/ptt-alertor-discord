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
    guild_id    TEXT NOT NULL DEFAULT '',
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
    guild_id     TEXT NOT NULL DEFAULT '',
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
    guild_id       TEXT NOT NULL DEFAULT '',
    created_at     DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  CREATE INDEX IF NOT EXISTS idx_eslite_subs_user    ON eslite_subscriptions(user_id);

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
    guild_id     TEXT NOT NULL DEFAULT '',
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
    guild_id     TEXT NOT NULL DEFAULT '',
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

  -- Per-guild PTT board state (last seen article ID per guild per board)
  CREATE TABLE IF NOT EXISTS guild_board_state (
    guild_id TEXT NOT NULL,
    board    TEXT NOT NULL COLLATE NOCASE,
    last_aid TEXT,
    PRIMARY KEY (guild_id, board)
  );

  -- PTT article thread (push) monitoring subscriptions
  CREATE TABLE IF NOT EXISTS ptt_thread_subscriptions (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id      TEXT NOT NULL,
    target_id    TEXT NOT NULL,
    target_type  TEXT NOT NULL CHECK(target_type IN ('channel', 'dm')),
    article_url  TEXT NOT NULL,
    keyword      TEXT NOT NULL DEFAULT '',
    guild_id     TEXT NOT NULL DEFAULT '',
    created_at   DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  CREATE INDEX IF NOT EXISTS idx_thread_subs_url  ON ptt_thread_subscriptions(article_url);
  CREATE INDEX IF NOT EXISTS idx_thread_subs_user ON ptt_thread_subscriptions(user_id);

  -- PTT thread state: tracks last seen push offset per article
  CREATE TABLE IF NOT EXISTS ptt_thread_state (
    article_url  TEXT PRIMARY KEY,
    poll_offset  TEXT,
    push_count   INTEGER NOT NULL DEFAULT 0,
    updated_at   DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  -- PTT sent notifications log: prevents duplicate cross-restart
  CREATE TABLE IF NOT EXISTS sent_ptt_notifications (
    target_id    TEXT NOT NULL,
    article_aid  TEXT NOT NULL,
    sent_at      DATETIME DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (target_id, article_aid)
  );

  CREATE INDEX IF NOT EXISTS idx_sent_ptt_notifications_sent_at
  ON sent_ptt_notifications(sent_at);
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

// Safe migration: add guild_id to all subscription tables
const subTables = ['subscriptions', 'shop_subscriptions', 'eslite_subscriptions', 'momo_subscriptions', 'shopee_subscriptions'];
for (const table of subTables) {
  try { db.exec(`ALTER TABLE ${table} ADD COLUMN guild_id TEXT NOT NULL DEFAULT ''`); } catch (_) {}
}

// Safe migration / reset: ensure eslite_subscriptions uses exhibition_id schema
try {
  const subCols = db.pragma('table_info(eslite_subscriptions)');
  const colNames = subCols.map(c => c.name);
  if (colNames.includes('keyword') || !colNames.includes('exhibition_id')) {
    db.exec(`
      DROP TABLE IF EXISTS eslite_subscriptions;
      CREATE TABLE eslite_subscriptions (
        id             INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id        TEXT NOT NULL,
        target_id      TEXT NOT NULL,
        target_type    TEXT NOT NULL CHECK(target_type IN ('channel', 'dm')),
        exhibition_id  TEXT NOT NULL,
        guild_id       TEXT NOT NULL DEFAULT '',
        created_at     DATETIME DEFAULT CURRENT_TIMESTAMP
      );
      CREATE INDEX IF NOT EXISTS idx_eslite_subs_user ON eslite_subscriptions(user_id);
    `);
  }
} catch (err) {
  console.error('[db] Error setting up eslite_subscriptions:', err.message);
}

// Safe migration / reset: ensure eslite_snapshots uses exhibition_id primary key
try {
  const snapCols = db.pragma('table_info(eslite_snapshots)');
  const snapColNames = snapCols.map(c => c.name);
  if (snapColNames.includes('keyword') || !snapColNames.includes('exhibition_id')) {
    db.exec(`
      DROP TABLE IF EXISTS eslite_snapshots;
      CREATE TABLE eslite_snapshots (
        exhibition_id TEXT PRIMARY KEY,
        snapshot_json TEXT NOT NULL,
        updated_at    DATETIME DEFAULT CURRENT_TIMESTAMP
      );
    `);
  }
} catch (err) {
  console.error('[db] Error setting up eslite_snapshots:', err.message);
}

// Clean up any pre-existing duplicate subscriptions across all platform tables
try {
  db.exec(`
    DELETE FROM subscriptions
    WHERE id NOT IN (
      SELECT MIN(id) FROM subscriptions
      GROUP BY user_id, target_id, LOWER(board), type, LOWER(match_value)
    );

    DELETE FROM shop_subscriptions
    WHERE id NOT IN (
      SELECT MIN(id) FROM shop_subscriptions
      GROUP BY user_id, target_id, category_url
    );

    DELETE FROM eslite_subscriptions
    WHERE id NOT IN (
      SELECT MIN(id) FROM eslite_subscriptions
      GROUP BY user_id, target_id, LOWER(exhibition_id)
    );

    DELETE FROM momo_subscriptions
    WHERE id NOT IN (
      SELECT MIN(id) FROM momo_subscriptions
      GROUP BY user_id, target_id, category_url
    );

    DELETE FROM shopee_subscriptions
    WHERE id NOT IN (
      SELECT MIN(id) FROM shopee_subscriptions
      GROUP BY user_id, target_id, search_url
    );
  `);
} catch (err) {
  console.error('[db] Error cleaning up duplicate subscriptions:', err.message);
}

// Add UNIQUE indexes to enforce deduplication at the DB level
try {
  db.exec(`
    CREATE UNIQUE INDEX IF NOT EXISTS idx_subscriptions_unique 
    ON subscriptions(user_id, target_id, board COLLATE NOCASE, type, match_value COLLATE NOCASE);

    CREATE UNIQUE INDEX IF NOT EXISTS idx_shop_subs_unique 
    ON shop_subscriptions(user_id, target_id, category_url);

    CREATE UNIQUE INDEX IF NOT EXISTS idx_eslite_subs_unique 
    ON eslite_subscriptions(user_id, target_id, exhibition_id COLLATE NOCASE);

    CREATE UNIQUE INDEX IF NOT EXISTS idx_momo_subs_unique 
    ON momo_subscriptions(user_id, target_id, category_url);

    CREATE UNIQUE INDEX IF NOT EXISTS idx_shopee_subs_unique 
    ON shopee_subscriptions(user_id, target_id, search_url);
  `);
} catch (_) {}

// ─── Prepared Statements ────────────────────────────────────────────────────

const stmts = {
  addSubscription: db.prepare(`
    INSERT INTO subscriptions (user_id, target_id, target_type, board, type, match_value, guild_id)
    VALUES (@user_id, @target_id, @target_type, @board, @type, @match_value, @guild_id)
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
    WHERE user_id = @user_id 
      AND target_id = @target_id 
      AND board = @board COLLATE NOCASE 
      AND type = @type 
      AND match_value = @match_value COLLATE NOCASE
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

  deleteSetting: db.prepare(`
    DELETE FROM settings WHERE key = @key
  `),

  getSettingsByPattern: db.prepare(`
    SELECT key, value FROM settings WHERE key LIKE @pattern
  `),

  getAllSettings: db.prepare(`
    SELECT key, value, updated_at FROM settings ORDER BY key
  `),

  // ── Per-guild board state ─────────────────────────────────────────────────

  getGuildBoardState: db.prepare(`
    SELECT last_aid FROM guild_board_state WHERE guild_id = @guild_id AND board = @board
  `),

  setGuildBoardState: db.prepare(`
    INSERT INTO guild_board_state (guild_id, board, last_aid)
    VALUES (@guild_id, @board, @last_aid)
    ON CONFLICT(guild_id, board) DO UPDATE SET last_aid = excluded.last_aid
  `),

  getDistinctGuildsForBoard: db.prepare(`
    SELECT DISTINCT guild_id FROM subscriptions WHERE board = @board
  `),

  getSubsForBoardAndGuild: db.prepare(`
    SELECT id, user_id, target_id, target_type, type, match_value
    FROM subscriptions
    WHERE board = @board AND guild_id = @guild_id
  `),

  // ── PTT thread (article push) subscriptions ───────────────────────────────

  addThreadSubscription: db.prepare(`
    INSERT INTO ptt_thread_subscriptions (user_id, target_id, target_type, article_url, keyword, guild_id)
    VALUES (@user_id, @target_id, @target_type, @article_url, @keyword, @guild_id)
  `),

  removeThreadSubscription: db.prepare(`
    DELETE FROM ptt_thread_subscriptions WHERE id = @id AND user_id = @user_id
  `),

  listThreadByUser: db.prepare(`
    SELECT id, article_url, keyword, target_type
    FROM ptt_thread_subscriptions
    WHERE user_id = @user_id AND target_id = @target_id
    ORDER BY id ASC
  `),

  getAllThreadArticles: db.prepare(`
    SELECT DISTINCT article_url FROM ptt_thread_subscriptions
  `),

  getThreadSubsForArticle: db.prepare(`
    SELECT id, user_id, target_id, target_type, keyword
    FROM ptt_thread_subscriptions
    WHERE article_url = @article_url
  `),

  findThreadSubscription: db.prepare(`
    SELECT id FROM ptt_thread_subscriptions
    WHERE user_id = @user_id AND target_id = @target_id AND article_url = @article_url AND keyword = @keyword
  `),

  getThreadState: db.prepare(`
    SELECT poll_offset, push_count FROM ptt_thread_state WHERE article_url = @article_url
  `),

  upsertThreadState: db.prepare(`
    INSERT INTO ptt_thread_state (article_url, poll_offset, push_count, updated_at)
    VALUES (@article_url, @poll_offset, @push_count, CURRENT_TIMESTAMP)
    ON CONFLICT(article_url) DO UPDATE SET
      poll_offset = excluded.poll_offset,
      push_count  = excluded.push_count,
      updated_at  = CURRENT_TIMESTAMP
  `),

  // ── Eslite restock ──────────────────────────────────────────────────────

  addEsliteSubscription: db.prepare(`
    INSERT INTO eslite_subscriptions (user_id, target_id, target_type, exhibition_id, guild_id)
    VALUES (@user_id, @target_id, @target_type, @exhibition_id, @guild_id)
  `),

  removeEsliteSubscription: db.prepare(`
    DELETE FROM eslite_subscriptions WHERE id = @id AND user_id = @user_id
  `),

  listEsliteByUser: db.prepare(`
    SELECT id, exhibition_id, target_type, created_at
    FROM eslite_subscriptions
    WHERE user_id = @user_id AND target_id = @target_id
    ORDER BY id ASC
  `),

  getAllEsliteExhibitions: db.prepare(`
    SELECT DISTINCT exhibition_id FROM eslite_subscriptions WHERE exhibition_id != ''
  `),

  getEsliteSubsForExhibition: db.prepare(`
    SELECT id, user_id, target_id, target_type, exhibition_id
    FROM eslite_subscriptions
    WHERE exhibition_id = @exhibition_id
  `),

  findEsliteSubscription: db.prepare(`
    SELECT id FROM eslite_subscriptions
    WHERE user_id = @user_id AND target_id = @target_id AND LOWER(exhibition_id) = LOWER(@exhibition_id)
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

  // ── PTT sent notifications ──────────────────────────────────────────────────

  hasPttNotificationBeenSent: db.prepare(`
    SELECT 1 FROM sent_ptt_notifications
    WHERE target_id = @target_id AND article_aid = @article_aid
    LIMIT 1
  `),

  recordPttSentNotification: db.prepare(`
    INSERT OR IGNORE INTO sent_ptt_notifications (target_id, article_aid)
    VALUES (@target_id, @article_aid)
  `),

  cleanupOldSentNotifications: db.prepare(`
    DELETE FROM sent_ptt_notifications WHERE sent_at < datetime('now', '-7 days')
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

// ─── Guild-Scoped Settings API ───────────────────────────────────────────────

/**
 * Get a guild-specific setting. Key stored as `guild:{guildId}:{key}`.
 * @param {string} guildId
 * @param {string} key
 * @returns {string|undefined}
 */
function getGuildSetting(guildId, key) {
  if (!guildId) return undefined;
  const row = stmts.getSetting.get({ key: `guild:${guildId}:${key}` });
  return row ? row.value : undefined;
}

/**
 * Set a guild-specific setting.
 * @param {string} guildId
 * @param {string} key
 * @param {string} value
 */
function setGuildSetting(guildId, key, value) {
  if (!guildId) return;
  stmts.setSetting.run({ key: `guild:${guildId}:${key}`, value });
}

/**
 * Delete a guild-specific setting (revert to global/env).
 * @param {string} guildId
 * @param {string} key
 */
function deleteGuildSetting(guildId, key) {
  if (!guildId) return;
  stmts.deleteSetting.run({ key: `guild:${guildId}:${key}` });
}

/**
 * Get the effective interval for a guild.
 * Priority: guild-specific setting → global DB setting → env fallback
 * @param {string} guildId
 * @param {string} key
 * @param {number} envFallback
 * @returns {number}
 */
function getGuildIntervalMs(guildId, key, envFallback) {
  const guildVal = getGuildSetting(guildId, key);
  if (guildVal !== undefined) {
    const parsed = parseInt(guildVal, 10);
    if (!isNaN(parsed) && parsed > 0) return parsed;
  }
  return getIntervalMs(key, envFallback);
}

/**
 * Get the minimum interval across all guilds and the global setting.
 * Used to determine how often the scraper loop should tick.
 * @param {string} key
 * @param {number} envFallback
 * @returns {number}
 */
function getMinIntervalMsAcrossGuilds(key, envFallback) {
  const globalInterval = getIntervalMs(key, envFallback);
  const pattern = `guild:%:${key}`;
  const rows = stmts.getSettingsByPattern.all({ pattern });
  let minMs = globalInterval;
  for (const row of rows) {
    const val = parseInt(row.value, 10);
    if (!isNaN(val) && val > 0) minMs = Math.min(minMs, val);
  }
  return minMs;
}

// ─── Per-Guild Board State API ───────────────────────────────────────────────

/**
 * Get the per-guild last seen article ID for a board.
 * Falls back to global board_state for guild_id = '' (legacy subscriptions).
 * @param {string} guildId
 * @param {string} board
 * @returns {string|null}
 */
function getGuildBoardState(guildId, board) {
  if (!guildId) return getBoardState(board);
  const row = stmts.getGuildBoardState.get({ guild_id: guildId, board });
  return row ? row.last_aid : null;
}

/**
 * Set the per-guild last seen article ID for a board.
 * Falls back to global board_state for guild_id = '' (legacy subscriptions).
 * @param {string} guildId
 * @param {string} board
 * @param {string} lastAid
 */
function setGuildBoardState(guildId, board, lastAid) {
  if (!guildId) {
    upsertBoardState(board, lastAid);
    return;
  }
  stmts.setGuildBoardState.run({ guild_id: guildId, board, last_aid: lastAid });
}

/**
 * Get all distinct guild IDs that have subscriptions for a board.
 * @param {string} board
 * @returns {string[]}
 */
function getDistinctGuildsForBoard(board) {
  return stmts.getDistinctGuildsForBoard.all({ board }).map(r => r.guild_id);
}

/**
 * Get all subscriptions for a specific board AND guild.
 * @param {string} board
 * @param {string} guildId
 * @returns {object[]}
 */
function getSubsForBoardAndGuild(board, guildId) {
  return stmts.getSubsForBoardAndGuild.all({ board, guild_id: guildId });
}

// ─── Eslite Restock API ─────────────────────────────────────────────────────

/** Add an eslite exhibition restock subscription. */
function addEsliteSubscription(params) {
  const result = stmts.addEsliteSubscription.run({
    user_id: params.user_id,
    target_id: params.target_id,
    target_type: params.target_type,
    exhibition_id: params.exhibition_id || params.keyword,
    guild_id: params.guild_id || '',
  });
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

/** Backward compatibility alias. */
function getAllEsliteKeywords() {
  return getAllEsliteExhibitions();
}

/** Get all eslite subscriptions for a specific exhibition. */
function getEsliteSubsForExhibition(exhibitionId) {
  return stmts.getEsliteSubsForExhibition.all({ exhibition_id: exhibitionId });
}

/** Backward compatibility alias. */
function getEsliteSubsForKeyword(keyword) {
  return getEsliteSubsForExhibition(keyword);
}

/** Check if an eslite subscription already exists. */
function findEsliteSubscription(params) {
  const exhibition_id = params.exhibition_id || params.keyword;
  return stmts.findEsliteSubscription.get({
    user_id: params.user_id,
    target_id: params.target_id,
    exhibition_id,
  });
}

/** Get the persisted inventory snapshot for an exhibition (parsed JSON or null). */
function getEsliteSnapshot(exhibitionId) {
  const row = stmts.getEsliteSnapshot.get({ exhibition_id: exhibitionId });
  if (!row) return null;
  try { return JSON.parse(row.snapshot_json); } catch { return null; }
}

/** Save/update the inventory snapshot for an exhibition. */
function upsertEsliteSnapshot(exhibitionId, snapshotObj) {
  stmts.upsertEsliteSnapshot.run({
    exhibition_id: exhibitionId,
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
  const thread = stmts.listThreadByUser.all({ user_id, target_id }).map(r => ({ ...r, platform: 'thread' }));
  const shop = stmts.listShopByUser.all({ user_id, target_id }).map(r => ({ ...r, platform: 'shop' }));
  const momo = stmts.listMomoByUser.all({ user_id, target_id }).map(r => ({ ...r, platform: 'momo' }));
  const eslite = stmts.listEsliteByUser.all({ user_id, target_id }).map(r => ({ ...r, platform: 'eslite' }));
  const shopee = stmts.listShopeeByUser.all({ user_id, target_id }).map(r => ({ ...r, platform: 'shopee' }));

  return [...ptt, ...thread, ...shop, ...momo, ...eslite, ...shopee];
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
    case 'thread':
      return removeThreadSubscription({ id, user_id });
    default:
      return 0;
  }
}

// ─── PTT Thread (Push) Subscription API ──────────────────────────────────────────

/** Add a thread push subscription. */
function addThreadSubscription(params) {
  const result = stmts.addThreadSubscription.run(params);
  return result.lastInsertRowid;
}

/** Remove a thread push subscription (only if owned by user_id). */
function removeThreadSubscription({ id, user_id }) {
  return stmts.removeThreadSubscription.run({ id, user_id }).changes;
}

/** List all thread push subscriptions for a user in a channel/dm. */
function listThreadSubscriptions({ user_id, target_id }) {
  return stmts.listThreadByUser.all({ user_id, target_id });
}

/** Get all distinct article URLs that have at least one thread subscription. */
function getAllThreadArticles() {
  return stmts.getAllThreadArticles.all().map(r => r.article_url);
}

/** Get all thread subscriptions for a specific article URL. */
function getThreadSubsForArticle(article_url) {
  return stmts.getThreadSubsForArticle.all({ article_url });
}

/** Check if a thread subscription already exists. */
function findThreadSubscription(params) {
  return stmts.findThreadSubscription.get(params);
}

/** Get the stored state (poll_offset, push_count) for a thread article. */
function getThreadState(article_url) {
  return stmts.getThreadState.get({ article_url }) || null;
}

/** Save/update the state for a thread article. */
function upsertThreadState(article_url, pollOffset, pushCount) {
  stmts.upsertThreadState.run({
    article_url,
    poll_offset: pollOffset,
    push_count:  pushCount,
  });
}

// ─── PTT Sent Notifications API ──────────────────────────────────────────────

/**
 * Check if a notification for (targetId, articleAid) has already been sent.
 * @param {string} targetId   Discord channel or user ID
 * @param {string} articleAid PTT article AID
 * @returns {boolean}
 */
function hasPttNotificationBeenSent(targetId, articleAid) {
  return !!stmts.hasPttNotificationBeenSent.get({ target_id: targetId, article_aid: articleAid });
}

/**
 * Record that a PTT article notification has been sent to a target.
 * Uses INSERT OR IGNORE so duplicate calls are safe.
 * @param {string} targetId   Discord channel or user ID
 * @param {string} articleAid PTT article AID
 */
function recordPttSentNotification(targetId, articleAid) {
  stmts.recordPttSentNotification.run({ target_id: targetId, article_aid: articleAid });
}

/**
 * Delete sent notification records older than 7 days.
 * Call once at startup to keep the table lightweight.
 */
function cleanupOldSentNotifications() {
  const result = stmts.cleanupOldSentNotifications.run();
  if (result.changes > 0) {
    console.log(`[db] 🧹 Cleaned up ${result.changes} expired sent_ptt_notifications records.`);
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
  // guild-scoped settings
  getGuildSetting,
  setGuildSetting,
  deleteGuildSetting,
  getGuildIntervalMs,
  getMinIntervalMsAcrossGuilds,
  // guild-scoped board state (PTT)
  getGuildBoardState,
  setGuildBoardState,
  getDistinctGuildsForBoard,
  getSubsForBoardAndGuild,
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
  getAllEsliteKeywords,
  getAllEsliteExhibitions,
  getEsliteSubsForKeyword,
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
  // ptt thread (push) monitoring
  addThreadSubscription,
  removeThreadSubscription,
  listThreadSubscriptions,
  getAllThreadArticles,
  getThreadSubsForArticle,
  findThreadSubscription,
  getThreadState,
  upsertThreadState,
  // ptt sent notifications
  hasPttNotificationBeenSent,
  recordPttSentNotification,
  cleanupOldSentNotifications,
};

