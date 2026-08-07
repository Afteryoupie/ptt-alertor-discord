'use strict';

const {
  SlashCommandBuilder,
  ChannelType,
  MessageFlags,
  PermissionFlagsBits,
} = require('discord.js');
const db = require('../database');
const { normalizeArticleUrl, crawlArticle, matchPushKeyword } = require('../thread-scraper');

// ─── Slash Command Definition ─────────────────────────────────────────────────

const data = new SlashCommandBuilder()
  .setName('thread-watch')
  .setDescription('監控 PTT 置底貼文的推文交易（即時通知新推文）')
  // ── add ──────────────────────────────────────────────────────────────────
  .addSubcommand(sub =>
    sub.setName('add')
      .setDescription('新增一個置底貼文推文監控')
      .addStringOption(opt =>
        opt.setName('url')
          .setDescription('PTT 文章 URL（例：https://www.ptt.cc/bbs/Headphone/M.xxxxx.html）')
          .setRequired(true))
      .addStringOption(opt =>
        opt.setName('keyword')
          .setDescription('過濾關鍵字（空格隔開 AND 條件，用 -keyword 排除。例："HD660S -徵"）')
          .setRequired(false))
      .addChannelOption(opt =>
        opt.setName('channel')
          .setDescription('通知頻道（預設：目前頻道）')
          .addChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement)
          .setRequired(false)))
  // ── remove ───────────────────────────────────────────────────────────────
  .addSubcommand(sub =>
    sub.setName('remove')
      .setDescription('刪除一個置底貼文推文監控')
      .addIntegerOption(opt =>
        opt.setName('id')
          .setDescription('監控 ID（用 /thread-watch list 查詢）')
          .setRequired(true)))
  // ── list ─────────────────────────────────────────────────────────────────
  .addSubcommand(sub =>
    sub.setName('list')
      .setDescription('列出目前所有置底貼文推文監控'));

// ─── Helper ───────────────────────────────────────────────────────────────────

/**
 * Extract board + article title fragment from a PTT article URL for display.
 * e.g. https://www.ptt.cc/bbs/Headphone/M.17xxxxx.A.xxx.html → Headphone / M.17xxxxx...
 */
function describeUrl(articleUrl) {
  const m = /\/bbs\/([^/]+)\/([^/]+\.html)/.exec(articleUrl);
  if (!m) return articleUrl;
  return `**${m[1]}** / \`${m[2]}\``;
}

// ─── Execute ──────────────────────────────────────────────────────────────────

async function execute(interaction) {
  const sub     = interaction.options.getSubcommand();
  const userId  = interaction.user.id;
  const inDM    = !interaction.guildId;
  const targetType = inDM ? 'dm' : 'channel';
  const targetId   = inDM ? userId : interaction.channelId;

  // ── list ──────────────────────────────────────────────────────────────────
  if (sub === 'list') {
    const rows = db.listThreadSubscriptions({ user_id: userId, target_id: targetId });
    if (!rows.length) {
      return interaction.reply({
        content: '📭 目前沒有置底貼文推文監控訂閱。\n使用 `/thread-watch add` 新增。',
        flags: [MessageFlags.Ephemeral],
      });
    }

    const lines = rows.map(r => {
      const kw = r.keyword ? `  🔍 \`${r.keyword}\`` : '';
      return `\`${r.id}\` ${describeUrl(r.article_url)}${kw}`;
    });

    return interaction.reply({
      content: [
        `📋 **置底貼文推文監控清單（${rows.length} 筆）**`,
        ``,
        ...lines,
        ``,
        `使用 \`/thread-watch remove id:<ID>\` 刪除。`,
      ].join('\n'),
      flags: [MessageFlags.Ephemeral],
    });
  }

  // ── remove ────────────────────────────────────────────────────────────────
  if (sub === 'remove') {
    const id = interaction.options.getInteger('id', true);
    const changed = db.removeThreadSubscription({ id, user_id: userId });
    if (!changed) {
      return interaction.reply({
        content: `❌ 找不到 ID \`${id}\` 的訂閱，或該訂閱不屬於你。`,
        flags: [MessageFlags.Ephemeral],
      });
    }
    return interaction.reply({
      content: `✅ 已刪除置底貼文推文監控 \`${id}\`。`,
      flags: [MessageFlags.Ephemeral],
    });
  }

  // ── add ───────────────────────────────────────────────────────────────────
  if (sub === 'add') {
    const rawUrl  = interaction.options.getString('url', true);
    const keyword = (interaction.options.getString('keyword') || '').trim();
    const channelOpt = interaction.options.getChannel('channel');

    // Determine actual target
    let effectiveTargetId   = targetId;
    let effectiveTargetType = targetType;
    if (channelOpt && !inDM) {
      effectiveTargetId   = channelOpt.id;
      effectiveTargetType = 'channel';
    }

    // Validate and normalize URL
    let articleUrl;
    try {
      articleUrl = normalizeArticleUrl(rawUrl);
      if (!/ptt\.cc\/bbs\/.+\/M\.\d+\.[A-Z]\.[A-F0-9]+\.html$/i.test(articleUrl)) {
        throw new Error('非有效的 PTT 文章 URL');
      }
    } catch (err) {
      return interaction.reply({
        content: `❌ URL 格式無效：\`${rawUrl}\`\n請輸入完整的 PTT 文章網址，例：\`https://www.ptt.cc/bbs/Headphone/M.1783654445.A.C47.html\``,
        flags: [MessageFlags.Ephemeral],
      });
    }

    // Check for duplicate
    const existing = db.findThreadSubscription({
      user_id:     userId,
      target_id:   effectiveTargetId,
      article_url: articleUrl,
      keyword,
    });
    if (existing) {
      return interaction.reply({
        content: `⚠️ 你已有一筆相同設定的推文監控（ID: \`${existing.id}\`）。`,
        flags: [MessageFlags.Ephemeral],
      });
    }

    // Defer reply — we'll do a trial fetch to confirm the article is reachable
    await interaction.deferReply({ flags: [MessageFlags.Ephemeral] });

    try {
      const { pushes, pollOffset } = await crawlArticle(articleUrl);

      // Save subscription
      const id = db.addThreadSubscription({
        user_id:     userId,
        target_id:   effectiveTargetId,
        target_type: effectiveTargetType,
        article_url: articleUrl,
        keyword,
        guild_id:    interaction.guildId || '',
      });

      // Initialize state (so we only notify on FUTURE pushes)
      db.upsertThreadState(articleUrl, pollOffset, pushes.length);

      const dest = inDM
        ? '私訊'
        : (channelOpt ? `<#${channelOpt.id}>` : `<#${interaction.channelId}>`);

      const kwLine = keyword
        ? `\n🔍 關鍵字過濾：\`${keyword}\`（空格=AND，-xxx=排除）`
        : '';

      // Show some recent matching pushes as preview
      let preview = '';
      if (pushes.length > 0) {
        const recent = pushes
          .filter(p => !keyword || matchPushKeyword(p.content, keyword))
          .slice(-5);
        if (recent.length > 0) {
          const lines = recent.map(p => `> \`${p.userid}\` ${p.content} _(${p.ipdatetime})_`);
          preview = `\n\n**最近符合的推文（最多 5 則，僅供預覽）：**\n${lines.join('\n')}`;
        }
      }

      return interaction.editReply({
        content: [
          `✅ **置底貼文推文監控已新增！** (ID: \`${id}\`)`,
          ``,
          `📰 ${describeUrl(articleUrl)}`,
          `🔗 ${articleUrl}`,
          `📬 通知頻道：${dest}`,
          `📊 目前推文數：**${pushes.length}** 則${kwLine}`,
          ``,
          `📌 將通知所有 _在此時間點之後_ 出現的新推文。${preview}`,
        ].join('\n'),
      });
    } catch (err) {
      console.error(`[thread-watch] 抓取文章失敗：${articleUrl}`, err.message);
      return interaction.editReply({
        content: `❌ 無法取得文章內容：\`${err.message}\`\n請確認 URL 正確且文章仍存在。`,
      });
    }
  }
}

module.exports = { data, execute };
