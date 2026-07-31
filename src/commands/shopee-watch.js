'use strict';

const { SlashCommandBuilder, MessageFlags } = require('discord.js');
const db = require('../database');
const { parseShopeeUrl, snapshotShopeeSearch } = require('../shopee-scraper');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('shopee-watch')
    .setDescription('管理蝦皮 (Shopee) 賣場與關鍵字商品補貨/新上架通知')
    .addSubcommand(sub =>
      sub
        .setName('add')
        .setDescription('新增蝦皮追蹤：當賣場有商品補貨或新上架時發送通知')
        .addStringOption(opt =>
          opt
            .setName('url')
            .setDescription('蝦皮搜尋或賣場 URL，例如 https://shopee.tw/search?keyword=戰鬥陀螺&shop=11664018')
            .setRequired(true)
        )
    )
    .addSubcommand(sub =>
      sub
        .setName('remove')
        .setDescription('移除蝦皮追蹤')
        .addIntegerOption(opt =>
          opt
            .setName('id')
            .setDescription('訂閱 ID（使用 /shopee-watch list 查詢）')
            .setRequired(true)
        )
    )
    .addSubcommand(sub =>
      sub
        .setName('list')
        .setDescription('列出此頻道的蝦皮追蹤訂閱')
    ),

  async execute(interaction) {
    const sub = interaction.options.getSubcommand();

    const isDM      = !interaction.guildId;
    const targetId   = isDM ? interaction.user.id : interaction.channelId;
    const targetType = isDM ? 'dm' : 'channel';
    const userId     = interaction.user.id;

    // ── ADD ──────────────────────────────────────────────────────────────────
    if (sub === 'add') {
      const rawUrl = interaction.options.getString('url', true);

      let parsed;
      try {
        parsed = parseShopeeUrl(rawUrl);
      } catch (err) {
        return interaction.reply({
          content: `❌ ${err.message || '無效的蝦皮網址'}\n\n範例：\`https://shopee.tw/search?keyword=戰鬥陀螺&shop=11664018\``,
          flags: [MessageFlags.Ephemeral],
        });
      }

      // Check duplicate
      const existing = db.findShopeeSubscription({
        user_id: userId,
        target_id: targetId,
        search_url: parsed.canonicalUrl,
      });

      if (existing) {
        return interaction.reply({
          content: `⚠️ 這個蝦皮追蹤網址已經在追蹤中了（ID: ${existing.id}）`,
          flags: [MessageFlags.Ephemeral],
        });
      }

      await interaction.deferReply();

      try {
        const id = db.addShopeeSubscription({
          user_id: userId,
          target_id: targetId,
          target_type: targetType,
          search_url: parsed.canonicalUrl,
          keyword: parsed.keyword,
          shop_id: parsed.shopId,
          guild_id: interaction.guildId || '',
        });

        // Initialize snapshot
        const snapshot = await snapshotShopeeSearch({ shopId: parsed.shopId, keyword: parsed.keyword });
        db.upsertShopeeSnapshot(parsed.canonicalUrl, snapshot);

        const shopName = snapshot.shopName || `賣場 ${parsed.shopId}`;
        const catInfo = snapshot.matchedCategory ? ` (包含「${snapshot.matchedCategory.displayName}」分類)` : '';

        return interaction.editReply({
          content: [
            `✅ **蝦皮追蹤已新增！** (ID: \`${id}\`)`,
            ``,
            `🏬 **賣場：** \`${shopName}\`${catInfo}`,
            `🔑 **關鍵字：** \`${parsed.keyword || '無'}\``,
            `🔗 ${parsed.canonicalUrl}`,
            ``,
            `當賣場有符合條件的商品補貨、價格變動或新商品上架時，我會在這裡通知你！`,
          ].join('\n'),
        });
      } catch (err) {
        console.error('[shopee-watch] Add Error:', err);
        return interaction.editReply({
          content: `❌ 新增失敗，請確認網址是否正確。錯誤訊息：${err.message}`,
        });
      }
    }

    // ── REMOVE ───────────────────────────────────────────────────────────────
    if (sub === 'remove') {
      const id = interaction.options.getInteger('id', true);
      const changed = db.removeShopeeSubscription({ id, user_id: userId });

      if (!changed) {
        return interaction.reply({
          content: `❌ 找不到 ID \`${id}\` 的訂閱，或者該訂閱不屬於你。`,
          flags: [MessageFlags.Ephemeral],
        });
      }

      return interaction.reply({
        content: `✅ 已移除蝦皮追蹤訂閱（ID: \`${id}\`）`,
      });
    }

    // ── LIST ─────────────────────────────────────────────────────────────────
    if (sub === 'list') {
      const subs = db.listShopeeSubscriptions({ user_id: userId, target_id: targetId });

      if (!subs.length) {
        return interaction.reply({
          content: '📭 目前沒有任何蝦皮追蹤。\n使用 `/shopee-watch add` 新增！',
          flags: [MessageFlags.Ephemeral],
        });
      }

      const lines = subs.map(s => {
        const label = s.keyword ? `🔑 ${s.keyword} (shop:${s.shop_id || '全站'})` : `🏬 shop:${s.shop_id}`;
        return `\`${String(s.id).padStart(3)}\` ｜ ${s.target_type === 'dm' ? '📩 DM' : '📢 頻道'} ｜ ${label}`;
      });

      return interaction.reply({
        content: [
          `📋 **目前的蝦皮追蹤訂閱（${subs.length} 筆）：**`,
          '',
          ...lines,
          '',
          '使用 `/shopee-watch remove <ID>` 移除訂閱，或使用 `/list` 檢視全平台追蹤。',
        ].join('\n'),
        flags: [MessageFlags.Ephemeral],
      });
    }
  },
};
