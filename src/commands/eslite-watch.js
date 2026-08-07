'use strict';

const { SlashCommandBuilder, MessageFlags } = require('discord.js');
const db = require('../database');
const { parseEsliteSearch, esliteSearchUrl } = require('../eslite-scraper');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('eslite-watch')
    .setDescription('管理誠品線上關鍵字搜尋補貨通知')
    .addSubcommand(sub =>
      sub
        .setName('add')
        .setDescription('新增誠品關鍵字搜尋追蹤：有商品補貨/新上架時通知此頻道')
        .addStringOption(opt =>
          opt
            .setName('keyword')
            .setDescription('誠品搜尋網址或關鍵字，例如 beyblade x 或 https://www.eslite.com/Search?keyword=...')
            .setRequired(true)
        )
    )
    .addSubcommand(sub =>
      sub
        .setName('remove')
        .setDescription('移除誠品關鍵字追蹤')
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
      const rawInput = interaction.options.getString('keyword') || interaction.options.getString('url') || '';

      let parsed;
      try {
        parsed = parseEsliteSearch(rawInput);
      } catch (err) {
        return interaction.reply({
          content: `❌ ${err.message || '無效的關鍵字或網址'}，請輸入關鍵字或誠品搜尋網址，例如：\n\`beyblade x\` 或 \`https://www.eslite.com/Search?keyword=beyblade+x\``,
          flags: [MessageFlags.Ephemeral],
        });
      }

      const { keyword, canonicalUrl } = parsed;

      // Check duplicate
      const existing = db.findEsliteSubscription({ user_id: userId, target_id: targetId, keyword });
      if (existing) {
        return interaction.reply({
          content: `⚠️ 關鍵字「${keyword}」已經在追蹤中了（ID: ${existing.id}）`,
          flags: [MessageFlags.Ephemeral],
        });
      }

      const id = db.addEsliteSubscription({
        user_id:     userId,
        target_id:   targetId,
        target_type: targetType,
        keyword,
        search_url:  canonicalUrl,
        guild_id:    interaction.guildId || '',
      });

      return interaction.reply({
        content: [
          `✅ **誠品補貨追蹤已新增！** (ID: \`${id}\`)`,
          ``,
          `🔍 **追蹤關鍵字：** 「${keyword}」`,
          `🔗 ${canonicalUrl}`,
          ``,
          `當搜尋結果有商品補貨、正式開賣或新上架時，我會在這裡通知你！`,
          `（第一次掃描會建立庫存基準，之後才會通知補貨變動）`,
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
        `\`${String(s.id).padStart(3)}\` ｜ ${s.target_type === 'dm' ? '📩 DM' : '📢 頻道'} ｜ 關鍵字：「${s.keyword}」\n  🔗 ${s.search_url || esliteSearchUrl(s.keyword)}`
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
