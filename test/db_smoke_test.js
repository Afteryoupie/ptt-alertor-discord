'use strict';

const assert = require('assert');
const db = require('../src/database');

console.log('🧪 正在執行 ptt-alertor-discord 資料庫與 Facade 煙霧測試 (Smoke Test)...');

const TEST_USER = 'test_user_clean_code';
const TEST_TARGET = 'test_channel_123';

try {
  // 1. 測試 PTT 訂閱 CRUD
  console.log('1. 測試 PTT 訂閱...');
  const subId = db.addSubscription({
    user_id: TEST_USER,
    target_id: TEST_TARGET,
    target_type: 'channel',
    board: 'HardwareSale',
    type: 'keyword',
    match_value: 'RTX 4090',
    guild_id: 'test_guild_1',
  });
  assert(subId > 0, 'addSubscription failed');

  const subs = db.listSubscriptions({ user_id: TEST_USER, target_id: TEST_TARGET });
  assert(subs.some(s => s.id === subId && s.match_value === 'RTX 4090'), 'listSubscriptions failed');

  // 2. 測試 Shop 訂閱 CRUD
  console.log('2. 測試 Shop 訂閱...');
  const shopSubId = db.addShopSubscription({
    user_id: TEST_USER,
    target_id: TEST_TARGET,
    target_type: 'channel',
    category_url: 'https://shop.funbox.com.tw/test',
  });
  assert(shopSubId > 0, 'addShopSubscription failed');

  // 3. 測試統一查詢 getUserAllSubscriptions
  console.log('3. 測試跨平台統一查詢 (getUserAllSubscriptions)...');
  const allSubs = db.getUserAllSubscriptions({ user_id: TEST_USER, target_id: TEST_TARGET });
  assert(allSubs.some(s => s.platform === 'ptt' && s.id === subId), 'unified ptt not found');
  assert(allSubs.some(s => s.platform === 'shop' && s.id === shopSubId), 'unified shop not found');

  // 4. 測試設定 Config
  console.log('4. 測試 Config 設定...');
  db.setSetting('test_config_key', '12345');
  assert.strictEqual(db.getSetting('test_config_key'), '12345', 'getSetting failed');
  assert.strictEqual(db.getIntervalMs('test_config_key', 9999), 12345, 'getIntervalMs failed');

  // 5. 測試統一刪除 removeSubscriptionByPlatform
  console.log('5. 測試統一刪除 (removeSubscriptionByPlatform)...');
  const pttDeleted = db.removeSubscriptionByPlatform({ platform: 'ptt', id: subId, user_id: TEST_USER });
  assert.strictEqual(pttDeleted, 1, 'removeSubscriptionByPlatform ptt failed');

  const shopDeleted = db.removeSubscriptionByPlatform({ platform: 'shop', id: shopSubId, user_id: TEST_USER });
  assert.strictEqual(shopDeleted, 1, 'removeSubscriptionByPlatform shop failed');

  console.log('✅ 所有資料庫 Facade 煙霧測試全部通過！');
} catch (err) {
  console.error('❌ 測試失敗:', err);
  process.exit(1);
}
