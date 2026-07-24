'use strict';

const { SlashCommandBuilder, MessageFlags } = require('discord.js');
const db = require('../database');
const { parseExhibitionId, exhibitionUrl } = require('../eslite-scraper');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('eslite-watch')
    .setDescription('管理誠品展覽頁面補貨通知')
    .addSubcommand(sub =>
      sub
        .setName('add')
        .setDescription('新增誠品展覽頁面追蹤：有商品補貨時通知此頻道')
        .addStringOption(opt =>
          opt
            .setName('url')
            .setDescription('誠品展覽頁面 URL，例如 https://www.eslite.com/exhibitions/CU202503-00091')
            .setRequired(true)
        )
    )
    .addSubcommand(sub =>
      sub
        .setName('remove')
        .setDescription('移除誠品展覽追蹤')
        .addIntegerOption(opt =>
          opt
            .setName('id')
            .setDescription('訂閱 ID（使用 /eslite-watch list 查詢）')
            .setRequired(true)
        )
    )
    .addSubcommand(sub =>
      sub
        .setName('list')
        .setDescription('列出此頻道的誠品補貨追蹤訂閱')
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

      let exhibitionId;
      try {
        exhibitionId = parseExhibitionId(rawUrl);
      } catch {
        return interaction.reply({
          content: '❌ 無效的 URL，請輸入誠品展覽頁面網址，例如：\n`https://www.eslite.com/exhibitions/CU202503-00091`',
          flags: [MessageFlags.Ephemeral],
        });
      }

      if (!exhibitionId) {
        return interaction.reply({
          content: '❌ 無法解析展覽 ID，請確認 URL 格式正確。',
          flags: [MessageFlags.Ephemeral],
        });
      }

      // Check duplicate
      const existing = db.findEsliteSubscription({ user_id: userId, target_id: targetId, exhibition_id: exhibitionId });
      if (existing) {
        return interaction.reply({
          content: `⚠️ 這個展覽頁面已經在追蹤中了（ID: ${existing.id}）`,
          flags: [MessageFlags.Ephemeral],
        });
      }

      const id = db.addEsliteSubscription({
        user_id:       userId,
        target_id:     targetId,
        target_type:   targetType,
        exhibition_id: exhibitionId,
      });

      return interaction.reply({
        content: [
          `✅ **誠品補貨追蹤已新增！** (ID: \`${id}\`)`,
          ``,
          `📦 **展覽 ID：** \`${exhibitionId}\``,
          `🔗 ${exhibitionUrl(exhibitionId)}`,
          ``,
          `當展覽頁面有商品從缺貨變為有貨時，我會在這裡通知你！`,
          `（第一次掃描會建立庫存基準，之後才會通知補貨）`,
        ].join('\n'),
      });
    }

    // ── REMOVE ───────────────────────────────────────────────────────────────
    if (sub === 'remove') {
      const id = interaction.options.getInteger('id', true);
      const changed = db.removeEsliteSubscription({ id, user_id: userId });

      if (!changed) {
        return interaction.reply({
          content: `❌ 找不到 ID \`${id}\` 的訂閱，或者該訂閱不屬於你。`,
          flags: [MessageFlags.Ephemeral],
        });
      }

      return interaction.reply({
        content: `✅ 已移除誠品補貨追蹤訂閱（ID: \`${id}\`）`,
      });
    }

    // ── LIST ─────────────────────────────────────────────────────────────────
    if (sub === 'list') {
      const subs = db.listEsliteSubscriptions({ user_id: userId, target_id: targetId });

      if (!subs.length) {
        return interaction.reply({
          content: '📭 目前沒有任何誠品補貨追蹤。\n使用 `/eslite-watch add` 新增！',
          flags: [MessageFlags.Ephemeral],
        });
      }

      const lines = subs.map(s =>
        `\`${String(s.id).padStart(3)}\` ｜ ${s.target_type === 'dm' ? '📩 DM' : '📢 頻道'} ｜ ${s.exhibition_id}`
      );

      return interaction.reply({
        content: [
          `📋 **目前的誠品補貨追蹤訂閱（${subs.length} 筆）：**`,
          '',
          ...lines,
          '',
          '使用 `/eslite-watch remove <ID>` 移除訂閱，或使用 `/list` 檢視全平台追蹤。',
        ].join('\n'),
        flags: [MessageFlags.Ephemeral],
      });
    }
  },
};
