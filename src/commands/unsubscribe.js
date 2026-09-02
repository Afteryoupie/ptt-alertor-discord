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
      return `🔑 **[PTT ${sub.board}]** ${sub.match_value} \`[ptt-${sub.id}]\``;
    case 'shop':
      return `🛍️ **[Funbox]** ${shopLabel(sub.category_url)} \`[shop-${sub.id}]\``;
    case 'momo':
      return `🍑 **[momo]** ${momoLabel(sub.category_url)} \`[momo-${sub.id}]\``;
    case 'eslite':
      return `📚 **[誠品]** \`${sub.exhibition_id}\` \`[eslite-${sub.id}]\``;
    case 'shopee':
      return `🟠 **[蝦皮]** ${sub.keyword ? `🔑 ${sub.keyword}` : `🏬 shop:${sub.shop_id}`} \`[shopee-${sub.id}]\``;
    default:
      return `追蹤項目 #${sub.id}`;
  }
}

function getSubLabel(sub) {
  switch (sub.platform) {
    case 'ptt':
      return `[PTT ${sub.board}] ${sub.match_value}`;
    case 'shop':
      return `[Funbox] ${shopLabel(sub.category_url)}`;
    case 'momo':
      return `[momo] ${momoLabel(sub.category_url)}`;
    case 'eslite':
      return `[誠品] ${sub.exhibition_id}`;
    case 'shopee':
      return `[蝦皮] ${sub.keyword || sub.shop_id || '追蹤'}`;
    default:
      return `追蹤項目 #${sub.id}`;
  }
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName('unsubscribe')
    .setDescription('刪除一筆追蹤或訂閱（可從下拉選單選擇，或輸入編號/ID）')
    .addStringOption(opt =>
      opt.setName('target')
        .setDescription('選擇要刪除的項目，或輸入全區編號 (例如 1) 或 ID (例如 momo-3)')
        .setRequired(true)
        .setAutocomplete(true)
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

      // Case 1: Target is platform-id format like "shop-3", "shopee-12", "momo-4", "eslite-5", "ptt-1"
      const platformMatch = rawTarget.toLowerCase().match(/^(ptt|shop|momo|eslite|shopee)[-_:]?(\d+)$/);
      if (platformMatch) {
        const [, platform, idStr] = platformMatch;
        const id = parseInt(idStr, 10);
        targetSub = rows.find(r => r.platform === platform && r.id === id);
      }

      // Case 2: Target is a numeric input (e.g. "1", "2")
      if (!targetSub && /^\d+$/.test(rawTarget)) {
        const num = parseInt(rawTarget, 10);
        
        // Priority 2a: Check if any subscription has this exact database ID
        const matchedById = rows.filter(r => r.id === num);
        if (matchedById.length === 1) {
          targetSub = matchedById[0];
        }

        // Priority 2b: Fall back to 1-based sequential index from current list
        if (!targetSub && num >= 1 && num <= rows.length) {
          targetSub = rows[num - 1];
        }
      }

      if (!targetSub) {
        await interaction.reply({
          content: `❌ 找不到與 \`${rawTarget}\` 相符的追蹤項目。請使用 \`/list\` 查詢或直接從指令下拉選單選取。`,
          flags: [MessageFlags.Ephemeral],
        });
        return;
      }

      db.removeSubscriptionByPlatform({
        platform: targetSub.platform,
        id: targetSub.id,
        user_id: userId,
      });

      await interaction.reply({
        content: `✅ 已成功刪除追蹤項目：\n${formatSubDescription(targetSub)}`,
        flags: [MessageFlags.Ephemeral],
      });
    } catch (err) {
      console.error('[unsubscribe] Error:', err);
      const msg = { content: '❌ 刪除失敗，請稍後再試。', flags: [MessageFlags.Ephemeral] };
      if (interaction.replied || interaction.deferred) {
        await interaction.followUp(msg).catch(() => {});
      } else {
        await interaction.reply(msg).catch(() => {});
      }
    }
  },

  async autocomplete(interaction) {
    const userId   = interaction.user.id;
    const inDM     = interaction.channel?.type === ChannelType.DM || !interaction.guildId;
    const targetId = inDM ? userId : interaction.channelId;

    try {
      const rows = db.getUserAllSubscriptions({ user_id: userId, target_id: targetId });
      const focusedValue = interaction.options.getFocused().toLowerCase();

      const choices = rows.map((r, index) => {
        const label = getSubLabel(r);
        const name = `${index + 1}. ${label} [${r.platform}-${r.id}]`.slice(0, 100);
        const value = `${r.platform}-${r.id}`;
        return { name, value, searchText: `${index + 1} ${label} ${value}`.toLowerCase() };
      });

      const filtered = choices
        .filter(c => !focusedValue || c.searchText.includes(focusedValue))
        .slice(0, 25);

      await interaction.respond(
        filtered.map(c => ({ name: c.name, value: c.value }))
      );
    } catch (err) {
      if (err.code !== 10062 && err.code !== 40060) {
        await interaction.respond([]).catch(() => {});
      }
    }
  },
};
