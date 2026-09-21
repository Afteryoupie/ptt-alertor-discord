'use strict';

const Database = require('better-sqlite3');
const path = require('path');
const fs = require('fs');

// Ensure data directory exists
const DATA_DIR = path.join(__dirname, '..', '..', 'data');
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

// Safe migration: add guild_id to all subscription tables
const subTables = ['subscriptions', 'shop_subscriptions', 'eslite_subscriptions', 'momo_subscriptions', 'shopee_subscriptions'];
for (const table of subTables) {
  try { db.exec(`ALTER TABLE ${table} ADD COLUMN guild_id TEXT NOT NULL DEFAULT ''`); } catch (_) {}
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

module.exports = {
  db,
};
