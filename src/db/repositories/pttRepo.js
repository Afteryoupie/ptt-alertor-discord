'use strict';

const { db } = require('../connection');

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

  // PTT Thread (Push) Subscriptions
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

function addSubscription(params) {
  return stmts.addSubscription.run(params).lastInsertRowid;
}

function removeSubscription({ id, user_id }) {
  return stmts.removeSubscription.run({ id, user_id }).changes;
}

function listSubscriptions({ user_id, target_id }) {
  return stmts.listByUser.all({ user_id, target_id });
}

function getAllBoards() {
  return stmts.getAllBoards.all().map(r => r.board);
}

function getSubsForBoard(board) {
  return stmts.getSubsForBoard.all({ board });
}

function getBoardState(board) {
  const row = stmts.getBoardState.get({ board });
  return row ? row.last_aid : null;
}

function upsertBoardState(board, last_aid) {
  stmts.upsertBoardState.run({ board, last_aid });
}

function findSubscription(params) {
  return stmts.findSubscription.get(params);
}

function getGuildBoardState(guildId, board) {
  if (!guildId) return getBoardState(board);
  const row = stmts.getGuildBoardState.get({ guild_id: guildId, board });
  return row ? row.last_aid : null;
}

function setGuildBoardState(guildId, board, lastAid) {
  if (!guildId) {
    upsertBoardState(board, lastAid);
    return;
  }
  stmts.setGuildBoardState.run({ guild_id: guildId, board, last_aid: lastAid });
}

function getDistinctGuildsForBoard(board) {
  return stmts.getDistinctGuildsForBoard.all({ board }).map(r => r.guild_id);
}

function getSubsForBoardAndGuild(board, guildId) {
  return stmts.getSubsForBoardAndGuild.all({ board, guild_id: guildId });
}

function addThreadSubscription(params) {
  return stmts.addThreadSubscription.run(params).lastInsertRowid;
}

function removeThreadSubscription({ id, user_id }) {
  return stmts.removeThreadSubscription.run({ id, user_id }).changes;
}

function listThreadSubscriptions({ user_id, target_id }) {
  return stmts.listThreadByUser.all({ user_id, target_id });
}

function getAllThreadArticles() {
  return stmts.getAllThreadArticles.all().map(r => r.article_url);
}

function getThreadSubsForArticle(article_url) {
  return stmts.getThreadSubsForArticle.all({ article_url });
}

function findThreadSubscription(params) {
  return stmts.findThreadSubscription.get(params);
}

function getThreadState(article_url) {
  return stmts.getThreadState.get({ article_url }) || null;
}

function upsertThreadState(article_url, pollOffset, pushCount) {
  stmts.upsertThreadState.run({
    article_url,
    poll_offset: pollOffset,
    push_count:  pushCount,
  });
}

function hasPttNotificationBeenSent(targetId, articleAid) {
  return !!stmts.hasPttNotificationBeenSent.get({ target_id: targetId, article_aid: articleAid });
}

function recordPttSentNotification(targetId, articleAid) {
  stmts.recordPttSentNotification.run({ target_id: targetId, article_aid: articleAid });
}

function cleanupOldSentNotifications() {
  const result = stmts.cleanupOldSentNotifications.run();
  if (result.changes > 0) {
    console.log(`[db] 🧹 Cleaned up ${result.changes} expired sent_ptt_notifications records.`);
  }
}

module.exports = {
  stmts,
  addSubscription,
  removeSubscription,
  listSubscriptions,
  getAllBoards,
  getSubsForBoard,
  getBoardState,
  upsertBoardState,
  findSubscription,
  getGuildBoardState,
  setGuildBoardState,
  getDistinctGuildsForBoard,
  getSubsForBoardAndGuild,
  addThreadSubscription,
  removeThreadSubscription,
  listThreadSubscriptions,
  getAllThreadArticles,
  getThreadSubsForArticle,
  findThreadSubscription,
  getThreadState,
  upsertThreadState,
  hasPttNotificationBeenSent,
  recordPttSentNotification,
  cleanupOldSentNotifications,
};
