'use strict';

/**
 * database.js - Facade for Modular Repositories
 * Preserves 100% backward compatibility with all commands and index.js.
 */

const { db } = require('./db/connection');
const pttRepo = require('./db/repositories/pttRepo');
const shopRepo = require('./db/repositories/shopRepo');
const configRepo = require('./db/repositories/configRepo');

/**
 * List all subscriptions across all platforms (PTT, Funbox, Momo, Eslite, Shopee) for a user in a channel/DM.
 * @param {{ user_id: string, target_id: string }} params
 */
function getUserAllSubscriptions({ user_id, target_id }) {
  const ptt = pttRepo.stmts.listByUser.all({ user_id, target_id }).map(r => ({ ...r, platform: 'ptt' }));
  const thread = pttRepo.stmts.listThreadByUser.all({ user_id, target_id }).map(r => ({ ...r, platform: 'thread' }));
  const shop = shopRepo.stmts.listShopByUser.all({ user_id, target_id }).map(r => ({ ...r, platform: 'shop' }));
  const momo = shopRepo.stmts.listMomoByUser.all({ user_id, target_id }).map(r => ({ ...r, platform: 'momo' }));
  const eslite = shopRepo.stmts.listEsliteByUser.all({ user_id, target_id }).map(r => ({ ...r, platform: 'eslite' }));
  const shopee = shopRepo.stmts.listShopeeByUser.all({ user_id, target_id }).map(r => ({ ...r, platform: 'shopee' }));

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
      return pttRepo.removeSubscription({ id, user_id });
    case 'shop':
      return shopRepo.removeShopSubscription({ id, user_id });
    case 'momo':
      return shopRepo.removeMomoSubscription({ id, user_id });
    case 'eslite':
      return shopRepo.removeEsliteSubscription({ id, user_id });
    case 'shopee':
      return shopRepo.removeShopeeSubscription({ id, user_id });
    case 'thread':
      return pttRepo.removeThreadSubscription({ id, user_id });
    default:
      return 0;
  }
}

module.exports = {
  db,

  // Settings & Config
  getSetting: configRepo.getSetting,
  setSetting: configRepo.setSetting,
  getIntervalMs: configRepo.getIntervalMs,
  getAllSettings: configRepo.getAllSettings,
  getGuildSetting: configRepo.getGuildSetting,
  setGuildSetting: configRepo.setGuildSetting,
  deleteGuildSetting: configRepo.deleteGuildSetting,
  getGuildIntervalMs: configRepo.getGuildIntervalMs,
  getMinIntervalMsAcrossGuilds: configRepo.getMinIntervalMsAcrossGuilds,

  // Unified
  getUserAllSubscriptions,
  removeSubscriptionByPlatform,

  // PTT Subscriptions & Board State
  addSubscription: pttRepo.addSubscription,
  removeSubscription: pttRepo.removeSubscription,
  listSubscriptions: pttRepo.listSubscriptions,
  getAllBoards: pttRepo.getAllBoards,
  getSubsForBoard: pttRepo.getSubsForBoard,
  getBoardState: pttRepo.getBoardState,
  upsertBoardState: pttRepo.upsertBoardState,
  findSubscription: pttRepo.findSubscription,
  getGuildBoardState: pttRepo.getGuildBoardState,
  setGuildBoardState: pttRepo.setGuildBoardState,
  getDistinctGuildsForBoard: pttRepo.getDistinctGuildsForBoard,
  getSubsForBoardAndGuild: pttRepo.getSubsForBoardAndGuild,

  // PTT Thread (Push) Monitoring
  addThreadSubscription: pttRepo.addThreadSubscription,
  removeThreadSubscription: pttRepo.removeThreadSubscription,
  listThreadSubscriptions: pttRepo.listThreadSubscriptions,
  getAllThreadArticles: pttRepo.getAllThreadArticles,
  getThreadSubsForArticle: pttRepo.getThreadSubsForArticle,
  findThreadSubscription: pttRepo.findThreadSubscription,
  getThreadState: pttRepo.getThreadState,
  upsertThreadState: pttRepo.upsertThreadState,
  hasPttNotificationBeenSent: pttRepo.hasPttNotificationBeenSent,
  recordPttSentNotification: pttRepo.recordPttSentNotification,
  cleanupOldSentNotifications: pttRepo.cleanupOldSentNotifications,

  // Shop Restock (Funbox)
  addShopSubscription: shopRepo.addShopSubscription,
  removeShopSubscription: shopRepo.removeShopSubscription,
  listShopSubscriptions: shopRepo.listShopSubscriptions,
  getAllShopCategories: shopRepo.getAllShopCategories,
  getShopSubsForCategory: shopRepo.getShopSubsForCategory,
  findShopSubscription: shopRepo.findShopSubscription,
  getShopSnapshot: shopRepo.getShopSnapshot,
  upsertShopSnapshot: shopRepo.upsertShopSnapshot,

  // Eslite Restock
  addEsliteSubscription: shopRepo.addEsliteSubscription,
  removeEsliteSubscription: shopRepo.removeEsliteSubscription,
  listEsliteSubscriptions: shopRepo.listEsliteSubscriptions,
  getAllEsliteExhibitions: shopRepo.getAllEsliteExhibitions,
  getEsliteSubsForExhibition: shopRepo.getEsliteSubsForExhibition,
  findEsliteSubscription: shopRepo.findEsliteSubscription,
  getEsliteSnapshot: shopRepo.getEsliteSnapshot,
  upsertEsliteSnapshot: shopRepo.upsertEsliteSnapshot,

  // Momo Restock
  addMomoSubscription: shopRepo.addMomoSubscription,
  removeMomoSubscription: shopRepo.removeMomoSubscription,
  listMomoSubscriptions: shopRepo.listMomoSubscriptions,
  getAllMomoCategories: shopRepo.getAllMomoCategories,
  getMomoSubsForCategory: shopRepo.getMomoSubsForCategory,
  findMomoSubscription: shopRepo.findMomoSubscription,
  getMomoSnapshot: shopRepo.getMomoSnapshot,
  upsertMomoSnapshot: shopRepo.upsertMomoSnapshot,

  // Shopee Restock
  addShopeeSubscription: shopRepo.addShopeeSubscription,
  removeShopeeSubscription: shopRepo.removeShopeeSubscription,
  listShopeeSubscriptions: shopRepo.listShopeeSubscriptions,
  getAllShopeeSearches: shopRepo.getAllShopeeSearches,
  getShopeeSubsForSearch: shopRepo.getShopeeSubsForSearch,
  findShopeeSubscription: shopRepo.findShopeeSubscription,
  getShopeeSnapshot: shopRepo.getShopeeSnapshot,
  upsertShopeeSnapshot: shopRepo.upsertShopeeSnapshot,
};
