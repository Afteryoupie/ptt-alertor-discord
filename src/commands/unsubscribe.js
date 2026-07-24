'use strict';

const { SlashCommandBuilder, MessageFlags, ChannelType } = require('discord.js');
const db = require('../database');

function shopLabel(url) {
  const match = url.match(/categories\/(.+)$/);
  return match ? match[1] : url;
}

function momoLabel(url) {
  try {
    const u = new URL(url);
    const d = u.searchParams.get('d_code');
    const m = u.searchParams.get('m_code');
    if (d) return `d:${d}`;
    if (m) return `m:${m}`;
  } catch (_) {}
  return url;
}

function formatSubDescription(sub) {
  switch (sub.platform) {
    case 'ptt':
      return `🔑 **[PTT ${sub.board}]** ${sub.match_value}`;
    case 'shop':
      return `🛍️ **[Funbox]** ${shopLabel(sub.category_url)}`;
    case 'momo':
      return `🍑 **[momo]** ${momoLabel(sub.category_url)}`;
    case 'eslite':
      return `📚 **[誠品]** ${sub.exhibition_id}`;
    case 'shopee':
      return `🟠 **[蝦皮]** ${sub.keyword ? `🔑 ${sub.keyword}` : `🏬 shop:${sub.shop_id}`}`;
    default:
      return `追蹤項目 #${sub.id}`;
  }
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName('unsubscribe')
    .setDescription('刪除一筆追蹤或訂閱（使用 /list 查看全區編號）')
    .addStringOption(opt =>
      opt.setName('target')
        .setDescription('全區清單中的編號 (例如 1, 2) 或平台項目 ID (例如 shopee-3)')
        .setRequired(true)
    ),

  async execute(interaction) {
    const rawTarget = interaction.options.getString('target', true).trim();
    const userId    = interaction.user.id;
    const inDM      = interaction.channel?.type === ChannelType.DM || !interaction.guildId;
    const targetId  = inDM ? userId : interaction.channelId;

    try {
      const rows = db.getUserAllSubscriptions({ user_id: userId, target_id: targetId });
      
      if (!rows.length) {
        await interaction.reply({ content: '❌ 您目前沒有任何追蹤訂閱。', flags: [MessageFlags.Ephemeral] });
        return;
      }

      let targetSub = null;
      let targetIndexStr = rawTarget;

      // Case 1: Target is a simple numeric index (e.g. "1", "2")
      if (/^\d+$/.test(rawTarget)) {
        const index = parseInt(rawTarget, 10);
        if (index < 1 || index > rows.length) {
          await interaction.reply({
            content: `❌ 找不到編號 \`${index}\`。您目前在此處共有 ${rows.length} 筆追蹤（請用 \`/list\` 查看）。`,
            flags: [MessageFlags.Ephemeral],
          });
          return;
        }
        targetSub = rows[index - 1];
      } else {
        // Case 2: Target is platform-id format like "shop-3" or "shopee-12"
        const match = rawTarget.toLowerCase().match(/^(ptt|shop|momo|eslite|shopee)[-_:]?(\d+)$/);
        if (match) {
          const [, platform, idStr] = match;
          const id = parseInt(idStr, 10);
          targetSub = rows.find(r => r.platform === platform && r.id === id);
        }
      }

      if (!targetSub) {
        await interaction.reply({
          content: `❌ 找不到與 \`${rawTarget}\` 相符的追蹤項目。請使用 \`/list\` 查詢正確編號。`,
          flags: [MessageFlags.Ephemeral],
        });
        return;
      }

      const deleted = db.removeSubscriptionByPlatform({
        platform: targetSub.platform,
        id: targetSub.id,
        user_id: userId,
      });

      if (deleted === 0) {
        await interaction.reply({
          content: `❌ 刪除失敗，該項目可能已被刪除或不属于您。`,
          flags: [MessageFlags.Ephemeral],
        });
      } else {
        await interaction.reply({
          content: `✅ 已成功刪除追蹤項目：\n${formatSubDescription(targetSub)}`,
          flags: [MessageFlags.Ephemeral],
        });
      }
    } catch (err) {
      console.error('[unsubscribe] Error:', err);
      await interaction.reply({ content: '❌ 刪除失敗，請稍後再試。', flags: [MessageFlags.Ephemeral] });
    }
  },
};

