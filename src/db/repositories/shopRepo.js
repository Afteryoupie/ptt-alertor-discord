'use strict';

const { db } = require('../connection');

const stmts = {
  // Funbox Shop
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

  // Eslite
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

  // Momo
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

  // Shopee
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

// Funbox methods
function addShopSubscription(params) {
  return stmts.addShopSubscription.run(params).lastInsertRowid;
}
function removeShopSubscription({ id, user_id }) {
  return stmts.removeShopSubscription.run({ id, user_id }).changes;
}
function listShopSubscriptions({ user_id, target_id }) {
  return stmts.listShopByUser.all({ user_id, target_id });
}
function getAllShopCategories() {
  return stmts.getAllShopCategories.all().map(r => r.category_url);
}
function getShopSubsForCategory(category_url) {
  return stmts.getShopSubsForCategory.all({ category_url });
}
function findShopSubscription(params) {
  return stmts.findShopSubscription.get(params);
}
function getShopSnapshot(category_url) {
  const row = stmts.getShopSnapshot.get({ category_url });
  if (!row) return null;
  try { return JSON.parse(row.snapshot_json); } catch { return null; }
}
function upsertShopSnapshot(category_url, snapshotObj) {
  stmts.upsertShopSnapshot.run({ category_url, snapshot_json: JSON.stringify(snapshotObj) });
}

// Eslite methods
function addEsliteSubscription(params) {
  return stmts.addEsliteSubscription.run({
    user_id: params.user_id,
    target_id: params.target_id,
    target_type: params.target_type,
    exhibition_id: params.exhibition_id || params.keyword,
    guild_id: params.guild_id || '',
  }).lastInsertRowid;
}
function removeEsliteSubscription({ id, user_id }) {
  return stmts.removeEsliteSubscription.run({ id, user_id }).changes;
}
function listEsliteSubscriptions({ user_id, target_id }) {
  return stmts.listEsliteByUser.all({ user_id, target_id });
}
function getAllEsliteExhibitions() {
  return stmts.getAllEsliteExhibitions.all().map(r => r.exhibition_id);
}
function getEsliteSubsForExhibition(exhibitionId) {
  return stmts.getEsliteSubsForExhibition.all({ exhibition_id: exhibitionId });
}
function findEsliteSubscription(params) {
  const exhibition_id = params.exhibition_id || params.keyword;
  return stmts.findEsliteSubscription.get({ user_id: params.user_id, target_id: params.target_id, exhibition_id });
}
function getEsliteSnapshot(exhibitionId) {
  const row = stmts.getEsliteSnapshot.get({ exhibition_id: exhibitionId });
  if (!row) return null;
  try { return JSON.parse(row.snapshot_json); } catch { return null; }
}
function upsertEsliteSnapshot(exhibitionId, snapshotObj) {
  stmts.upsertEsliteSnapshot.run({ exhibition_id: exhibitionId, snapshot_json: JSON.stringify(snapshotObj) });
}

// Momo methods
function addMomoSubscription(params) {
  return stmts.addMomoSubscription.run(params).lastInsertRowid;
}
function removeMomoSubscription({ id, user_id }) {
  return stmts.removeMomoSubscription.run({ id, user_id }).changes;
}
function listMomoSubscriptions({ user_id, target_id }) {
  return stmts.listMomoByUser.all({ user_id, target_id });
}
function getAllMomoCategories() {
  return stmts.getAllMomoCategories.all().map(r => r.category_url);
}
function getMomoSubsForCategory(category_url) {
  return stmts.getMomoSubsForCategory.all({ category_url });
}
function findMomoSubscription(params) {
  return stmts.findMomoSubscription.get(params);
}
function getMomoSnapshot(category_url) {
  const row = stmts.getMomoSnapshot.get({ category_url });
  if (!row) return null;
  try { return JSON.parse(row.snapshot_json); } catch { return null; }
}
function upsertMomoSnapshot(category_url, snapshotObj) {
  stmts.upsertMomoSnapshot.run({ category_url, snapshot_json: JSON.stringify(snapshotObj) });
}

// Shopee methods
function addShopeeSubscription(params) {
  return stmts.addShopeeSubscription.run(params).lastInsertRowid;
}
function removeShopeeSubscription({ id, user_id }) {
  return stmts.removeShopeeSubscription.run({ id, user_id }).changes;
}
function listShopeeSubscriptions({ user_id, target_id }) {
  return stmts.listShopeeByUser.all({ user_id, target_id });
}
function getAllShopeeSearches() {
  return stmts.getAllShopeeSearches.all();
}
function getShopeeSubsForSearch(search_url) {
  return stmts.getShopeeSubsForSearch.all({ search_url });
}
function findShopeeSubscription(params) {
  return stmts.findShopeeSubscription.get(params);
}
function getShopeeSnapshot(search_url) {
  const row = stmts.getShopeeSnapshot.get({ search_url });
  if (!row) return null;
  try { return JSON.parse(row.snapshot_json); } catch { return null; }
}
function upsertShopeeSnapshot(search_url, snapshotObj) {
  stmts.upsertShopeeSnapshot.run({ search_url, snapshot_json: JSON.stringify(snapshotObj) });
}

module.exports = {
  stmts,
  addShopSubscription,
  removeShopSubscription,
  listShopSubscriptions,
  getAllShopCategories,
  getShopSubsForCategory,
  findShopSubscription,
  getShopSnapshot,
  upsertShopSnapshot,
  addEsliteSubscription,
  removeEsliteSubscription,
  listEsliteSubscriptions,
  getAllEsliteExhibitions,
  getEsliteSubsForExhibition,
  findEsliteSubscription,
  getEsliteSnapshot,
  upsertEsliteSnapshot,
  addMomoSubscription,
  removeMomoSubscription,
  listMomoSubscriptions,
  getAllMomoCategories,
  getMomoSubsForCategory,
  findMomoSubscription,
  getMomoSnapshot,
  upsertMomoSnapshot,
  addShopeeSubscription,
  removeShopeeSubscription,
  listShopeeSubscriptions,
  getAllShopeeSearches,
  getShopeeSubsForSearch,
  findShopeeSubscription,
  getShopeeSnapshot,
  upsertShopeeSnapshot,
};
