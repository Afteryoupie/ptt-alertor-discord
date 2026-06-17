'use strict';

// ─── /shop-autobuy command ────────────────────────────────────────────────────
//
// Subcommands:
//   setup <cookie>  — store an encrypted session cookie for auto-buy
//   status          — show whether a cookie is configured
//   remove          — delete the stored cookie
//   test            — validate whether the stored cookie is still active

const { SlashCommandBuilder, MessageFlags } = require('discord.js');
const db = require('../database');
const { encryptCookie, decryptCookie } = require('../crypto-utils');
const { validateSession } = require('../shop-buyer');

const COOKIE_INSTRUCTIONS = [
  '**如何取得 Funbox session cookie：**',
  '1. 用瀏覽器登入 <https://shop.funbox.com.tw>',
  '2. 開啟開發者工具（F12 或 Cmd+Option+I）',
  '3. 前往 **Application** → **Cookies** → `shop.funbox.com.tw`',
  '4. 找到 **`_cyberbiz_session`** 這個 cookie，複製它的值',
  '5. 使用 `/shop-autobuy setup <值>` 指令，格式為：',
  '   `_cyberbiz_session=貼上你複製的值`',
  '',
  '> ⚠️ Cookie 會隨時間失效，請定期更新。',
  '> 🔒 Cookie 以 AES-256 加密儲存，Bot 擁有者無法直接讀取。',
].join('\n');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('shop-autobuy')
    .setDescription('設定補貨後自動購買（使用您的 Funbox 登入 Cookie）')
    .addSubcommand(sub =>
      sub
        .setName('setup')
        .setDescription('設定 Funbox session cookie，啟用補貨自動購買')
        .addStringOption(opt =>
          opt
            .setName('cookie')
            .setDescription('瀏覽器 DevTools 中複製的 Cookie 標頭值')
            .setRequired(true)
        )
    )
    .addSubcommand(sub =>
      sub
        .setName('status')
        .setDescription('查看目前自動購買設定狀態')
    )
    .addSubcommand(sub =>
      sub
        .setName('remove')
        .setDescription('刪除已儲存的 Cookie，停用自動購買')
    )
    .addSubcommand(sub =>
      sub
        .setName('test')
        .setDescription('測試目前儲存的 Cookie 是否仍然有效')
    )
    .addSubcommand(sub =>
      sub
        .setName('profile')
        .setDescription('設定結帳資訊（姓名、Email、手機）— 需先執行 setup')
        .addStringOption(opt =>
          opt.setName('name').setDescription('購買人姓名').setRequired(true)
        )
        .addStringOption(opt =>
          opt.setName('email').setDescription('電子郵件').setRequired(true)
        )
        .addStringOption(opt =>
          opt.setName('phone').setDescription('手機號碼（從0開頭）').setRequired(true)
        )
        .addStringOption(opt =>
          opt.setName('store_id').setDescription('7-Eleven 門市代碼（預設:962380 大五股）').setRequired(false)
        )
        .addStringOption(opt =>
          opt.setName('store_name').setDescription('7-Eleven 門市名稱（預設:大五股門市）').setRequired(false)
        )
    ),

  async execute(interaction) {
    const sub    = interaction.options.getSubcommand();
    const userId = interaction.user.id;

    // ── SETUP ─────────────────────────────────────────────────────────────────
    if (sub === 'setup') {
      // Defer ephemerally — cookie should never be visible to others
      await interaction.deferReply({ flags: [MessageFlags.Ephemeral] });

      let rawCookie = interaction.options.getString('cookie', true).trim();

      // If user pasted just the value without the key name, prepend it
      if (!rawCookie.includes('=')) {
        rawCookie = `_cyberbiz_session=${rawCookie}`;
      }

      if (!rawCookie || rawCookie.length < 10) {
        return interaction.editReply({
          content: `❌ Cookie 格式看起來不正確，請確認您複製了完整的 Cookie 值。\n\n${COOKIE_INSTRUCTIONS}`,
        });
      }

      // Check AUTOBUY_SECRET is configured
      if (!process.env.AUTOBUY_SECRET) {
        return interaction.editReply({
          content: '❌ 伺服器尚未設定 `AUTOBUY_SECRET`，請聯繫 Bot 管理員在 `.env` 中設定此金鑰。',
        });
      }

      let encrypted;
      try {
        encrypted = encryptCookie(rawCookie);
      } catch (err) {
        console.error('[shop-autobuy] encryptCookie error:', err.message);
        return interaction.editReply({
          content: `❌ 加密失敗：${err.message}`,
        });
      }

      db.setAutobuyConfig({
        user_id:          userId,
        encrypted_cookie: encrypted.encrypted,
        iv:               encrypted.iv,
        auth_tag:         encrypted.authTag,
      });

      return interaction.editReply({
        content: [
          '✅ **自動購買 Cookie 已儲存！**',
          '',
          '🔒 Cookie 以 AES-256-GCM 加密儲存，只有 Bot 可以使用。',
          '🛒 下次偵測到您訂閱分類的補貨時，Bot 會自動購買最低價的有貨商品（1 件）。',
          '⚠️ **警告：請確保您的 Funbox 購物車平時保持淨空，否則自動下單時可能會將購物車內現有商品一併結帳。**',
          '',
          '使用 `/shop-autobuy test` 驗證 Cookie 是否有效。',
          '使用 `/shop-autobuy remove` 停用自動購買。',
        ].join('\n'),
      });
    }

    // ── STATUS ────────────────────────────────────────────────────────────────
    if (sub === 'status') {
      const has = db.hasAutobuyConfig(userId);

      if (!has) {
        return interaction.reply({
          content: [
            '📭 **尚未設定自動購買。**',
            '',
            '使用 `/shop-autobuy setup <cookie>` 設定 Funbox session cookie 後，',
            '補貨時 Bot 將自動幫您購買。',
            '',
            COOKIE_INSTRUCTIONS,
          ].join('\n'),
          flags: [MessageFlags.Ephemeral],
        });
      }

      return interaction.reply({
        content: [
          '✅ **自動購買已啟用**',
          '',
          '🔒 Cookie 以加密形式儲存於資料庫。',
          '🛒 偵測到您訂閱的分類補貨時，Bot 會自動購買最低價有貨商品（1 件）。',
          '⚠️ **警告：請確保您的 Funbox 購物車平時保持淨空，否則自動下單時可能會將購物車內現有商品一併結帳。**',
          '',
          '• `/shop-autobuy test` — 驗證 Cookie 有效性',
          '• `/shop-autobuy remove` — 停用自動購買',
        ].join('\n'),
        flags: [MessageFlags.Ephemeral],
      });
    }

    // ── REMOVE ────────────────────────────────────────────────────────────────
    if (sub === 'remove') {
      const deleted = db.deleteAutobuyConfig(userId);

      if (!deleted) {
        return interaction.reply({
          content: '⚠️ 找不到自動購買設定（可能尚未設定）。',
          flags: [MessageFlags.Ephemeral],
        });
      }

      return interaction.reply({
        content: '✅ 已刪除自動購買設定，Cookie 已從資料庫移除。',
        flags: [MessageFlags.Ephemeral],
      });
    }

    // ── TEST ──────────────────────────────────────────────────────────────────
    if (sub === 'test') {
      await interaction.deferReply({ flags: [MessageFlags.Ephemeral] });

      const config = db.getAutobuyConfig(userId);
      if (!config) {
        return interaction.editReply({
          content: '⚠️ 尚未設定自動購買。請先使用 `/shop-autobuy setup <cookie>` 設定。',
        });
      }

      const plainCookie = decryptCookie({
        encrypted: config.encrypted_cookie,
        iv:        config.iv,
        authTag:   config.auth_tag,
      });

      if (!plainCookie) {
        return interaction.editReply({
          content: [
            '❌ **Cookie 解密失敗。**',
            '可能是 `AUTOBUY_SECRET` 金鑰已更換。',
            '請重新執行 `/shop-autobuy setup <cookie>` 設定新 Cookie。',
          ].join('\n'),
        });
      }

      const { valid, email } = await validateSession(plainCookie);

      if (valid) {
        return interaction.editReply({
          content: [
            '✅ **Cookie 驗證成功！** 自動購買已就緒。',
            email ? `👤 登入帳號：${email}` : '',
          ].filter(Boolean).join('\n'),
        });
      } else {
        return interaction.editReply({
          content: [
            '❌ **Cookie 已失效或無法驗證。**',
            '',
            '請重新登入 Funbox，複製新的 Cookie，然後執行：',
            '`/shop-autobuy setup <new_cookie>`',
            '',
            COOKIE_INSTRUCTIONS,
          ].join('\n'),
        });
      }
    }

    // ── PROFILE ──────────────────────────────────────────────────────
    if (sub === 'profile') {
      if (!db.hasAutobuyConfig(userId)) {
        return interaction.reply({
          content: '⚠️ 請先執行 `/shop-autobuy setup <cookie>` 設定 Cookie，再設定結帳資訊。',
          flags: [MessageFlags.Ephemeral],
        });
      }

      const name      = interaction.options.getString('name',  true).trim();
      const email     = interaction.options.getString('email', true).trim();
      const phone     = interaction.options.getString('phone', true).trim();
      const storeId   = (interaction.options.getString('store_id')   || '962380').trim();
      const storeName = (interaction.options.getString('store_name') || '大五股門市').trim();
      const storeAddr = `${storeName}(新北市五股區成泰路二段81號)`;

      db.setAutobuyProfile({
        user_id:          userId,
        name,
        email,
        phone,
        seven_store_id:   storeId,
        seven_store_name: storeName,
        seven_store_addr: storeAddr,
      });

      return interaction.reply({
        content: [
          '✅ **結帳資訊已儲存！**',
          '',
          `👤 姓名：${name}`,
          `📧 Email：${email}`,
          `📱 手機：${phone}`,
          `🏦 7-Eleven：${storeName}（代碼 ${storeId}）`,
          '',
          '自動購買觸發時會使用以上資訊進行超商取貨付款結帳。',
        ].join('\n'),
        flags: [MessageFlags.Ephemeral],
      });
    }
  },
};

