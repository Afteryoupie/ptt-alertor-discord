'use strict';

const { SlashCommandBuilder, MessageFlags } = require('discord.js');
const db = require('../database');
const { parseCategoryInput, categoryUrl } = require('../momo-scraper');

/**
 * Extract a short human-readable label from a momo category URL.
 * e.g. "https://...DgrpCategory.jsp?d_code=2701202072" → "d:2701202072"
 */
function categoryLabel(url) {
  try {
    const u = new URL(url);
    const d = u.searchParams.get('d_code');
    const m = u.searchParams.get('m_code');
    if (d) return `d:${d}`;
    if (m) return `m:${m}`;
  } catch (_) {}
  return url;
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName('momo-watch')
    .setDescription('管理 momo 購物網分類補貨/開賣通知')
    .addSubcommand(sub =>
      sub
        .setName('add')
        .setDescription('新增 momo 分類追蹤：有商品補貨或即將開賣時通知此頻道')
        .addStringOption(opt =>
          opt
            .setName('url')
            .setDescription('momo 分類頁面 URL 或分類代碼，例如 https://www.momoshop.com.tw/category/DgrpCategory.jsp?d_code=2701202072')
            .setRequired(true)
        )
    )
    .addSubcommand(sub =>
      sub
        .setName('remove')
        .setDescription('移除 momo 分類追蹤')
        .addIntegerOption(opt =>
          opt
            .setName('id')
            .setDescription('訂閱 ID（使用 /momo-watch list 查詢）')
            .setRequired(true)
        )
    )
    .addSubcommand(sub =>
      sub
        .setName('list')
        .setDescription('列出此頻道的 momo 補貨追蹤訂閱')
    ),

  async execute(interaction) {
    const sub = interaction.options.getSubcommand();

    const isDM      = !interaction.guildId;
    const targetId   = isDM ? interaction.user.id : interaction.channelId;
    const targetType = isDM ? 'dm' : 'channel';
    const userId     = interaction.user.id;

    // ── ADD ──────────────────────────────────────────────────────────────────
    if (sub === 'add') {
      const rawInput = interaction.options.getString('url', true);

      let parsed;
      try {
        parsed = parseCategoryInput(rawInput);
      } catch (err) {
        return interaction.reply({
          content: [
            '❌ 無法解析 momo 分類 URL，請確認格式正確。',
            '',
            '支援格式：',
            '• `https://www.momoshop.com.tw/category/DgrpCategory.jsp?d_code=2701202072`',
            '• `https://www.momoshop.com.tw/category/MgrpCategory.jsp?m_code=2701201978`',
            '• 品牌旗艦館/店中店：`https://www.momoshop.com.tw/TP/TP0002451/search?keyword=戰鬥陀螺`',
            '• 純數字代碼（如 `2701202072`）',
          ].join('\n'),
          flags: [MessageFlags.Ephemeral],
        });
      }

      const canonicalUrl = categoryUrl(parsed.cateCode, parsed.cateType);

      // Check duplicate
      const existing = db.findMomoSubscription({ user_id: userId, target_id: targetId, category_url: canonicalUrl });
      if (existing) {
        return interaction.reply({
          content: `⚠️ 這個 momo 分類已經在追蹤中了（ID: ${existing.id}）`,
          flags: [MessageFlags.Ephemeral],
        });
      }

      const id = db.addMomoSubscription({
        user_id:      userId,
        target_id:    targetId,
        target_type:  targetType,
        category_url: canonicalUrl,
        guild_id:     interaction.guildId || '',
      });

      return interaction.reply({
        content: [
          `✅ **momo 補貨追蹤已新增！** (ID: \`${id}\`)`,
          ``,
          `📦 **分類代碼：** \`${parsed.cateType}_code=${parsed.cateCode}\``,
          `🔗 ${canonicalUrl}`,
          ``,
          `當此分類有商品補貨或即將開賣時，我會在這裡通知你！`,
          `（第一次掃描會建立庫存基準，之後才會通知）`,
        ].join('\n'),
      });
    }

    // ── REMOVE ───────────────────────────────────────────────────────────────
    if (sub === 'remove') {
      const id = interaction.options.getInteger('id', true);
      const changed = db.removeMomoSubscription({ id, user_id: userId });

      if (!changed) {
        return interaction.reply({
          content: `❌ 找不到 ID \`${id}\` 的訂閱，或者該訂閱不屬於你。`,
          flags: [MessageFlags.Ephemeral],
        });
      }

      return interaction.reply({
        content: `✅ 已移除 momo 補貨追蹤訂閱（ID: \`${id}\`）`,
      });
    }

    // ── LIST ─────────────────────────────────────────────────────────────────
    if (sub === 'list') {
      const subs = db.listMomoSubscriptions({ user_id: userId, target_id: targetId });

      if (!subs.length) {
        return interaction.reply({
          content: '📭 目前沒有任何 momo 補貨追蹤。\n使用 `/momo-watch add` 新增！',
          flags: [MessageFlags.Ephemeral],
        });
      }

      const lines = subs.map(s =>
        `\`${String(s.id).padStart(3)}\` ｜ ${s.target_type === 'dm' ? '📩 DM' : '📢 頻道'} ｜ ${categoryLabel(s.category_url)}`
      );

      return interaction.reply({
        content: [
          `📋 **目前的 momo 補貨追蹤訂閱（${subs.length} 筆）：**`,
          '',
          ...lines,
          '',
          '使用 `/momo-watch remove <ID>` 移除訂閱，或使用 `/list` 檢視全平台追蹤。',
        ].join('\n'),
        flags: [MessageFlags.Ephemeral],
      });
    }
  },
};
