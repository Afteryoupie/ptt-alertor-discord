'use strict';

const { SlashCommandBuilder, MessageFlags } = require('discord.js');
const db = require('../database');

// Normalize a shop URL to a canonical category_url stored in DB
// Accepts full URLs like "https://shop.funbox.com.tw/categories/XI/KB"
// or short paths like "XI/KB"
function normalizeCategoryUrl(input) {
  // Strip trailing slash and whitespace
  const trimmed = input.trim().replace(/\/$/, '');

  // If it already looks like a full URL, canonicalize it
  if (trimmed.startsWith('http')) {
    try {
      const u = new URL(trimmed);
      // Keep only the path portion starting from /categories/
      const match = u.pathname.match(/\/categories\/(.+)/);
      if (match) {
        return `https://shop.funbox.com.tw/categories/${match[1]}`;
      }
    } catch (_) { /* fall through */ }
  }

  // Treat as a path fragment
  // e.g. "XI/KB" or "/categories/XI/KB"
  const pathMatch = trimmed.match(/(?:categories\/)?(.+)/);
  const path = pathMatch ? pathMatch[1].replace(/^\/+/, '') : trimmed;
  return `https://shop.funbox.com.tw/categories/${path}`;
}

// Extract a readable display label from a category URL
function categoryLabel(url) {
  const match = url.match(/categories\/(.+)$/);
  return match ? match[1] : url;
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName('shop-watch')
    .setDescription('管理 Funbox 商店補貨通知')
    .addSubcommand(sub =>
      sub
        .setName('add')
        .setDescription('新增補貨追蹤：當分類有商品補貨時通知此頻道')
        .addStringOption(opt =>
          opt
            .setName('url')
            .setDescription('Funbox 商品分類 URL，例如 https://shop.funbox.com.tw/categories/XI/KB')
            .setRequired(true)
        )
    )
    .addSubcommand(sub =>
      sub
        .setName('remove')
        .setDescription('移除補貨追蹤')
        .addIntegerOption(opt =>
          opt
            .setName('id')
            .setDescription('訂閱 ID（使用 /shop-watch list 查詢）')
            .setRequired(true)
        )
    )
    .addSubcommand(sub =>
      sub
        .setName('list')
        .setDescription('列出此頻道的補貨追蹤訂閱')
    ),

  async execute(interaction) {
    const sub = interaction.options.getSubcommand();

    // Determine target (channel or DM)
    const isDM = !interaction.guildId;
    const targetId   = isDM ? interaction.user.id : interaction.channelId;
    const targetType = isDM ? 'dm' : 'channel';
    const userId     = interaction.user.id;

    // ── ADD ──────────────────────────────────────────────────────────────────
    if (sub === 'add') {
      const rawUrl = interaction.options.getString('url', true);
      const categoryUrl = normalizeCategoryUrl(rawUrl);

      // Validate: must contain /categories/
      if (!categoryUrl.includes('/categories/')) {
        return interaction.reply({
          content: '❌ 無效的 URL，請輸入 Funbox 分類頁面網址，例如：\n`https://shop.funbox.com.tw/categories/XI/KB`',
          flags: [MessageFlags.Ephemeral],
        });
      }

      // Check duplicate
      const existing = db.findShopSubscription({ user_id: userId, target_id: targetId, category_url: categoryUrl });
      if (existing) {
        return interaction.reply({
          content: `⚠️ 這個分類已經在追蹤中了（ID: ${existing.id}）`,
          flags: [MessageFlags.Ephemeral],
        });
      }

      const id = db.addShopSubscription({
        user_id:      userId,
        target_id:    targetId,
        target_type:  targetType,
        category_url: categoryUrl,
      });

      return interaction.reply({
        content: [
          `✅ **補貨追蹤已新增！** (ID: \`${id}\`)`,
          ``,
          `📦 **分類：** \`${categoryLabel(categoryUrl)}\``,
          `🔗 ${categoryUrl}`,
          ``,
          `當此分類有商品從缺貨變為有貨時，我會在這裡通知你！`,
          `（第一次掃描會建立庫存基準，之後才會通知補貨）`,
        ].join('\n'),
      });
    }

    // ── REMOVE ───────────────────────────────────────────────────────────────
    if (sub === 'remove') {
      const id = interaction.options.getInteger('id', true);
      const changed = db.removeShopSubscription({ id, user_id: userId });

      if (!changed) {
        return interaction.reply({
          content: `❌ 找不到 ID \`${id}\` 的訂閱，或者該訂閱不屬於你。`,
          flags: [MessageFlags.Ephemeral],
        });
      }

      return interaction.reply({
        content: `✅ 已移除補貨追蹤訂閱（ID: \`${id}\`）`,
      });
    }

    // ── LIST ─────────────────────────────────────────────────────────────────
    if (sub === 'list') {
      const subs = db.listShopSubscriptions({ user_id: userId, target_id: targetId });

      if (!subs.length) {
        return interaction.reply({
          content: '📭 目前沒有任何商店補貨追蹤。\n使用 `/shop-watch add` 新增！',
          flags: [MessageFlags.Ephemeral],
        });
      }

      const lines = subs.map(s =>
        `\`${String(s.id).padStart(3)}\` ｜ ${s.target_type === 'dm' ? '📩 DM' : '📢 頻道'} ｜ ${categoryLabel(s.category_url)}`
      );

      return interaction.reply({
        content: [
          `📋 **目前的補貨追蹤訂閱（${subs.length} 筆）：**`,
          '',
          ...lines,
          '',
          '使用 `/shop-watch remove <ID>` 移除訂閱。',
        ].join('\n'),
        flags: [MessageFlags.Ephemeral],
      });
    }
  },
};
