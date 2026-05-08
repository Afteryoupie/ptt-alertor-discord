'use strict';

const { SlashCommandBuilder } = require('discord.js');
const db = require('../database');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('unsubscribe')
    .setDescription('刪除一筆訂閱（用 /list 查看編號）')
    .addIntegerOption(opt =>
      opt.setName('id')
        .setDescription('訂閱編號')
        .setRequired(true)
        .setMinValue(1)
    ),

  async execute(interaction) {
    const id     = interaction.options.getInteger('id');
    const userId = interaction.user.id;

    try {
      const deleted = db.removeSubscription({ id, user_id: userId });

      if (deleted === 0) {
        await interaction.reply({
          content: `❌ 找不到編號 \`${id}\` 的訂閱，或該訂閱不屬於你。`,
          ephemeral: true,
        });
      } else {
        await interaction.reply({
          content: `✅ 已刪除訂閱編號 \`${id}\`。`,
          ephemeral: true,
        });
      }
    } catch (err) {
      console.error('[unsubscribe] Error:', err);
      await interaction.reply({ content: '❌ 刪除失敗，請稍後再試。', ephemeral: true });
    }
  },
};
