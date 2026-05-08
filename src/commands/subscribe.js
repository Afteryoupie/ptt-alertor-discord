'use strict';

const { SlashCommandBuilder, ChannelType } = require('discord.js');
const db = require('../database');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('subscribe')
    .setDescription('訂閱 PTT 看板的文章通知')
    .addStringOption(opt =>
      opt.setName('board')
        .setDescription('看板名稱，例如：DC_SALE')
        .setRequired(true)
    )
    .addStringOption(opt =>
      opt.setName('type')
        .setDescription('追蹤類型')
        .setRequired(true)
        .addChoices(
          { name: '關鍵字', value: 'keyword' },
          { name: '作者',   value: 'author'  }
        )
    )
    .addStringOption(opt =>
      opt.setName('value')
        .setDescription('關鍵字（支援 -排除詞，例：iPhone -128G）或作者 ID')
        .setRequired(true)
    ),

  async execute(interaction) {
    const board      = interaction.options.getString('board').trim();
    const type       = interaction.options.getString('type');
    const matchValue = interaction.options.getString('value').trim();
    const userId     = interaction.user.id;

    // Determine target: channel or DM
    const inDM = interaction.channel?.type === ChannelType.DM || !interaction.guildId;
    const targetType = inDM ? 'dm' : 'channel';
    const targetId   = inDM ? userId : interaction.channelId;

    try {
      const id = db.addSubscription({
        user_id:     userId,
        target_id:   targetId,
        target_type: targetType,
        board,
        type,
        match_value: matchValue,
      });

      const dest = inDM ? '私訊' : `<#${targetId}>`;
      await interaction.reply({
        content: `✅ 已訂閱 **[${board}]** 的 ${type === 'keyword' ? '關鍵字' : '作者'} \`${matchValue}\`\n通知將發送至：${dest}\n（訂閱編號：\`${id}\`，可用 \`/unsubscribe\` 刪除）`,
        ephemeral: true,
      });
    } catch (err) {
      console.error('[subscribe] Error:', err);
      await interaction.reply({ content: '❌ 訂閱失敗，請稍後再試。', ephemeral: true });
    }
  },
};
