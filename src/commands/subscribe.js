'use strict';

const { SlashCommandBuilder, ChannelType, MessageFlags } = require('discord.js');
const db = require('../database');
const { crawlBoard, matchKeyword, matchAuthor } = require('../scraper');
const { sendNotifications } = require('../notifier');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('subscribe')
    .setDescription('訂閱 PTT 看板的文章通知（支援多關鍵字、排除詞、作者）')
    .addStringOption(opt =>
      opt.setName('board')
        .setDescription('看板名稱 (如: MacShop, Lifeismoney)')
        .setRequired(true)
        .setAutocomplete(true)
    )
    .addStringOption(opt =>
      opt.setName('type')
        .setDescription('追蹤類型：關鍵字或作者')
        .setRequired(true)
        .addChoices(
          { name: '關鍵字', value: 'keyword' },
          { name: '作者',   value: 'author'  }
        )
    )
    .addStringOption(opt =>
      opt.setName('value')
        .setDescription('關鍵字 (多個用空格隔開為 AND，-排除詞) 或作者 ID (皆不分大小寫)')
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
      // Check for duplicate
      const existing = db.findSubscription({
        user_id: userId,
        target_id: targetId,
        board,
        type,
        match_value: matchValue,
      });

      if (existing) {
        await interaction.reply({
          content: `⚠️ 您已經訂閱過 **[${board}]** 的 ${type === 'keyword' ? '關鍵字' : '作者'} \`${matchValue}\` 了（編號：\`${existing.id}\`）。`,
          flags: [MessageFlags.Ephemeral],
        });
        return;
      }

      const id = db.addSubscription({
        user_id:     userId,
        target_id:   targetId,
        target_type: targetType,
        board,
        type,
        match_value: matchValue,
      });

      // Get the current list to find the sequential index of the new subscription
      const rows = db.listSubscriptions({ user_id: userId, target_id: targetId });
      const index = rows.length;

      const dest = inDM ? '私訊' : `<#${targetId}>`;
      await interaction.reply({
        content: `✅ 已訂閱 **[${board}]** 的 ${type === 'keyword' ? '關鍵字' : '作者'} \`${matchValue}\`\n通知將發送至：${dest}\n（目前總計第 \`${index}\` 筆訂閱，可用 \`/unsubscribe\` 刪除）\n\n*正在嘗試抓取最新一篇文章進行確認...*`,
        flags: [MessageFlags.Ephemeral],
      });

      // --- Instant Verification ---
      try {
        // Fetch current articles via crawlBoard (reuses the same HTTP request)
        const { allArticles, currentNewestAid } = await crawlBoard(board, null);

        // Find the LATEST (last in the array) that matches
        let lastMatch = null;
        for (let i = allArticles.length - 1; i >= 0; i--) {
          const a = allArticles[i];
          const matched = (type === 'keyword') ? matchKeyword(a.title, matchValue) : matchAuthor(a.author, matchValue);
          if (matched) {
            lastMatch = a;
            break;
          }
        }

        if (lastMatch) {
          await sendNotifications(interaction.client, [{
            article: lastMatch,
            board,
            matchType: type,
            matchValue: matchValue,
            targetId: targetId,
            targetType: targetType
          }]);
        } else {
          await interaction.followUp({
            content: `💡 訂閱成功，但在 **[${board}]** 的首頁目前沒看到符合 \`${matchValue}\` 的最新文章。\n之後若有新貼文我會立刻通知您！`,
            flags: [MessageFlags.Ephemeral],
          });
        }

        // Always update board state with the newest AID seen during instant verification
        // so that the background scraper loop won't notify old/verified articles again.
        if (currentNewestAid) {
          db.upsertBoardState(board, currentNewestAid);
        }

      } catch (crawlErr) {
        console.error('[subscribe-verify] Error:', crawlErr.message);
        await interaction.followUp({
          content: `⚠️ 訂閱已紀錄，但抓取測試文章時發生錯誤（${crawlErr.message}）。\n請放心，背景監控仍會持續運作。`,
          flags: [MessageFlags.Ephemeral],
        });
      }

    } catch (err) {
      console.error('[subscribe] Error:', err);
      await interaction.reply({ content: '❌ 訂閱失敗，請稍後再試。', flags: [MessageFlags.Ephemeral] });
    }
  },

  async autocomplete(interaction) {
    const focusedValue = interaction.options.getFocused().toLowerCase();
    const choices = ['MacShop', 'DC_SALE', 'steam', 'Gossiping', 'Lifeismoney', 'Life', 'Gamesale', 'HardwareSale'];
    
    const filtered = choices
      .filter(choice => choice.toLowerCase().includes(focusedValue))
      .slice(0, 25); // Discord limit is 25

    await interaction.respond(
      filtered.map(choice => ({ name: choice, value: choice }))
    );
  },
};
