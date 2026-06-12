'use strict';

// ─── Auto-buy Test Script ──────────────────────────────────────────────────────
// Usage:
//   node test-autobuy.js <session-cookie>
//
// Example:
//   node test-autobuy.js "_cb_session=abc123xyz; ..."
//
// This will attempt to purchase product nu24838 (原神Q版表情包系列徽章-納西妲, NT$80)
// using the provided session cookie and print the result.

require('dotenv').config();

const { buyProduct, validateSession } = require('./src/shop-buyer');

const TEST_HANDLE = 'nu24838'; // 原神Q版表情包系列徽章-納西妲, NT$80

const cookie = process.argv[2];

if (!cookie) {
  console.error('❌ 請提供 session cookie 作為第一個參數');
  console.error('   用法: node test-autobuy.js "<cookie>"');
  console.error('   取得方式: 登入 shop.funbox.com.tw → F12 → Application → Cookies');
  process.exit(1);
}

(async () => {
  console.log('='.repeat(60));
  console.log('🧪 Auto-buy 測試腳本');
  console.log('='.repeat(60));
  console.log(`🛍  商品: https://shop.funbox.com.tw/products/${TEST_HANDLE}`);
  console.log('');

  // Step 1: Validate session
  console.log('🔑 [1/2] 驗證 session cookie...');
  const { valid, email } = await validateSession(cookie);

  if (!valid) {
    console.error('❌ Cookie 無效或已過期！');
    console.error('   請重新登入 Funbox 並複製新的 Cookie。');
    process.exit(1);
  }

  console.log(`✅ Cookie 有效！${email ? ` 登入帳號: ${email}` : ''}`);
  console.log('');

  // Step 2: Attempt purchase
  console.log('🛒 [2/2] 嘗試購買商品...');
  console.log('   ⚠️  這將進行真實購買！按 Ctrl+C 可在 5 秒內取消...');
  await new Promise(r => setTimeout(r, 5000));

  const result = await buyProduct(cookie, TEST_HANDLE);

  console.log('');
  console.log('='.repeat(60));

  if (result.success) {
    console.log('✅ 購買成功！');
    console.log(`   📦 規格: ${result.variantTitle || '(預設)'}`);
    console.log(`   💰 金額: NT$${result.price}`);
    console.log(`   📋 訂單: ${result.orderId}`);
    if (result.orderUrl) console.log(`   🔗 連結: ${result.orderUrl}`);
  } else {
    console.log('❌ 購買失敗');
    console.log(`   原因: ${result.error}`);
    console.log(`   🔗 請手動購買: https://shop.funbox.com.tw/products/${TEST_HANDLE}`);
  }

  console.log('='.repeat(60));
})();
