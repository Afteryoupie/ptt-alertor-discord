'use strict';

const { SlashCommandBuilder, EmbedBuilder, ChannelType, MessageFlags } = require('discord.js');
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

module.exports = {
  data: new SlashCommandBuilder()
    .setName('list')
    .setDescription('列出目前你在此頻道/私訊的全平台追蹤與訂閱清單'),

  async execute(interaction) {
    const userId  = interaction.user.id;
    const inDM    = interaction.channel?.type === ChannelType.DM || !interaction.guildId;
    const targetId = inDM ? userId : interaction.channelId;

    try {
      const rows = db.getUserAllSubscriptions({ user_id: userId, target_id: targetId });

      if (!rows.length) {
        await interaction.reply({
          content: '📭 你在此處沒有任何追蹤訂閱。\n可使用 `/subscribe`、`/funbox-watch add` 等指令新增追蹤。',
          flags: [MessageFlags.Ephemeral],
        });
        return;
      }

      // Group items by platform for beautiful display, while maintaining continuous index numbers
      const sections = {
        ptt: { title: '🔑 **PTT 訂閱**', items: [] },
        shop: { title: '🛍️ **Funbox 商店補貨**', items: [] },
        momo: { title: '🍑 **momo 補貨**', items: [] },
        eslite: { title: '📚 **誠品展覽補貨**', items: [] },
        shopee: { title: '🟠 **蝦皮 Shopee 追蹤**', items: [] },
      };

      rows.forEach((r, index) => {
        const num = index + 1;
        const dest = r.target_type === 'dm' ? '📩私訊' : '📢頻道';

        if (r.platform === 'ptt') {
          const icon = r.type === 'keyword' ? '🔑' : '👤';
          sections.ptt.items.push(`\`${num}\`. ${icon} **[${r.board}]** ${r.match_value} (${dest}) \`[ptt-${r.id}]\``);
        } else if (r.platform === 'shop') {
          sections.shop.items.push(`\`${num}\`. 🛍️ **[Funbox]** ${shopLabel(r.category_url)} (${dest}) \`[shop-${r.id}]\``);
        } else if (r.platform === 'momo') {
          sections.momo.items.push(`\`${num}\`. 🍑 **[momo]** ${momoLabel(r.category_url)} (${dest}) \`[momo-${r.id}]\``);
        } else if (r.platform === 'eslite') {
          sections.eslite.items.push(`\`${num}\`. 📚 **[誠品]** \`${r.exhibition_id}\` (${dest}) \`[eslite-${r.id}]\``);
        } else if (r.platform === 'shopee') {
          const label = r.keyword ? `🔑 ${r.keyword} (shop:${r.shop_id || '全站'})` : `🏬 shop:${r.shop_id}`;
          sections.shopee.items.push(`\`${num}\`. 🟠 **[蝦皮]** ${label} (${dest}) \`[shopee-${r.id}]\``);
        }
      });

      const outputLines = [];
      for (const key of Object.keys(sections)) {
        const sec = sections[key];
        if (sec.items.length > 0) {
          outputLines.push(sec.title);
          outputLines.push(...sec.items);
          outputLines.push('');
        }
      }

      const embed = new EmbedBuilder()
        .setColor(0x0077b6)
        .setTitle('📋 你的全平台追蹤清單')
        .setDescription(outputLines.join('\n').trim())
        .setFooter({ text: `共 ${rows.length} 筆追蹤｜用 /unsubscribe [全區編號] 刪除` })
        .setTimestamp();

      await interaction.reply({ embeds: [embed], flags: [MessageFlags.Ephemeral] });
    } catch (err) {
      console.error('[list] Error:', err);
      const msg = { content: '❌ 查詢失敗，請稍後再試。', flags: [MessageFlags.Ephemeral] };
      if (interaction.replied || interaction.deferred) {
        await interaction.followUp(msg).catch(() => {});
      } else {
        await interaction.reply(msg).catch(() => {});
      }
    }
  },
};

