'use strict';

const { SlashCommandBuilder, EmbedBuilder, ChannelType } = require('discord.js');
const db = require('../database');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('list')
    .setDescription('列出目前你在此頻道/私訊的所有訂閱'),

  async execute(interaction) {
    const userId  = interaction.user.id;
    const inDM    = interaction.channel?.type === ChannelType.DM || !interaction.guildId;
    const targetId = inDM ? userId : interaction.channelId;

    try {
      const rows = db.listSubscriptions({ user_id: userId, target_id: targetId });

      if (!rows.length) {
        await interaction.reply({
          content: '📭 你在此處沒有任何訂閱。\n使用 `/subscribe` 新增追蹤。',
          ephemeral: true,
        });
        return;
      }

      const lines = rows.map(r => {
        const icon = r.type === 'keyword' ? '🔑' : '👤';
        const dest = r.target_type === 'dm' ? '📩私訊' : '📢頻道';
        return `\`${String(r.id).padStart(4)}\` ${icon} **[${r.board}]** ${r.match_value} (${dest})`;
      });

      const embed = new EmbedBuilder()
        .setColor(0x0077b6)
        .setTitle('📋 你的 PTT 訂閱清單')
        .setDescription(lines.join('\n'))
        .setFooter({ text: `共 ${rows.length} 筆｜用 /unsubscribe [編號] 刪除` })
        .setTimestamp();

      await interaction.reply({ embeds: [embed], ephemeral: true });
    } catch (err) {
      console.error('[list] Error:', err);
      await interaction.reply({ content: '❌ 查詢失敗，請稍後再試。', ephemeral: true });
    }
  },
};
