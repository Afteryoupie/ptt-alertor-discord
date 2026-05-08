'use strict';

const { SlashCommandBuilder, MessageFlags, ChannelType } = require('discord.js');
const db = require('../database');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('unsubscribe')
    .setDescription('刪除一筆訂閱（用 /list 查看編號）')
    .addIntegerOption(opt =>
      opt.setName('index')
        .setDescription('清單中的編號 (1, 2, 3...)')
        .setRequired(true)
        .setMinValue(1)
    ),

  async execute(interaction) {
    const index  = interaction.options.getInteger('index');
    const userId = interaction.user.id;
    const inDM    = interaction.channel?.type === ChannelType.DM || !interaction.guildId;
    const targetId = inDM ? userId : interaction.channelId;

    try {
      // Fetch the same list as /list would
      const rows = db.listSubscriptions({ user_id: userId, target_id: targetId });
      
      if (!rows.length) {
        await interaction.reply({ content: '❌ 您目前沒有任何訂閱。', flags: [MessageFlags.Ephemeral] });
        return;
      }

      if (index > rows.length) {
        await interaction.reply({
          content: `❌ 找不到編號 \`${index}\`。您目前只有 ${rows.length} 筆訂閱。`,
          flags: [MessageFlags.Ephemeral],
        });
        return;
      }

      const targetSub = rows[index - 1];
      const deleted = db.removeSubscription({ id: targetSub.id, user_id: userId });

      if (deleted === 0) {
        await interaction.reply({
          content: `❌ 刪除失敗，請稍後再試。`,
          flags: [MessageFlags.Ephemeral],
        });
      } else {
        await interaction.reply({
          content: `✅ 已刪除訂閱編號 \`${index}\`：**[${targetSub.board}]** ${targetSub.match_value}`,
          flags: [MessageFlags.Ephemeral],
        });
      }
    } catch (err) {
      console.error('[unsubscribe] Error:', err);
      await interaction.reply({ content: '❌ 刪除失敗，請稍後再試。', flags: [MessageFlags.Ephemeral] });
    }
  },
};
