'use strict';

const { SlashCommandBuilder, MessageFlags } = require('discord.js');
const db = require('../database');
const { parseCategoryInput: parseShopCategoryInput } = require('../shop-scraper');
const { parseExhibitionUrl: parseEsliteExhibitionUrl, exhibitionUrl } = require('../eslite-scraper');
const { parseCategoryInput: parseMomoCategoryInput, categoryUrl: momoCategoryUrl } = require('../momo-scraper');
const { parseShopeeUrl } = require('../shopee-scraper');
const { normalizeArticleUrl, crawlArticle } = require('../thread-scraper');

/**
 * Auto-detect platform from URL input.
 * @param {string} inputUrl
 * @returns {'shopee' | 'momo' | 'eslite' | 'shop' | 'thread' | null}
 */
function detectPlatform(inputUrl) {
  if (/ptt\.cc\/bbs\/.+\/M\.\d+\.[A-Z]\.[A-F0-9]+\.html/i.test(inputUrl)) return 'thread';
  try { parseShopeeUrl(inputUrl); return 'shopee'; } catch (_) {}
  try { parseMomoCategoryInput(inputUrl); return 'momo'; } catch (_) {}
  try { parseEsliteExhibitionUrl(inputUrl); return 'eslite'; } catch (_) {}
  try { parseShopCategoryInput(inputUrl); return 'shop'; } catch (_) {}
  return null;
}

/** Helper function to handle adding subscription per platform */
function handleAddByPlatform(platform, rawInput, userId, targetId, targetType, guildId) {
  if (platform === 'shopee') {
    const parsed = parseShopeeUrl(rawInput);
    const existing = db.findShopeeSubscription({ user_id: userId, target_id: targetId, search_url: parsed.canonicalUrl });
    if (existing) {
      return { status: 'exists', message: `⚠️ 這個蝦皮網址已經在追蹤中了（ID: shopee-${existing.id}）` };
    }
    const subId = db.addShopeeSubscription({
      user_id: userId,
      target_id: targetId,
      target_type: targetType,
      search_url: parsed.canonicalUrl,
      keyword: parsed.keyword,
      shop_id: parsed.shopId,
      guild_id: guildId || '',
    });
    return {
      status: 'success',
      platformName: '🟠 蝦皮 Shopee',
      title: parsed.keyword ? `關鍵字：「${parsed.keyword}」 (賣場: ${parsed.shopId || '全站'})` : `賣場 ID: ${parsed.shopId}`,
      canonicalUrl: parsed.canonicalUrl,
      id: `shopee-${subId}`,
    };
  }

  if (platform === 'momo') {
    const parsed = parseMomoCategoryInput(rawInput);
    const canonicalUrl = momoCategoryUrl(parsed.cateCode, parsed.cateType);
    const existing = db.findMomoSubscription({ user_id: userId, target_id: targetId, category_url: canonicalUrl });
    if (existing) {
      return { status: 'exists', message: `⚠️ 這個 momo 分類已經在追蹤中了（ID: momo-${existing.id}）` };
    }
    const subId = db.addMomoSubscription({
      user_id: userId,
      target_id: targetId,
      target_type: targetType,
      category_url: canonicalUrl,
      guild_id: guildId || '',
    });
    return {
      status: 'success',
      platformName: '🍑 momo 購物網',
      title: `分類 (${parsed.cateType === 'tp' ? '品牌旗艦館' : parsed.cateType.toUpperCase() + '碼'}): \`${parsed.cateCode}\``,
      canonicalUrl,
      id: `momo-${subId}`,
    };
  }

  if (platform === 'eslite') {
    const exhibitionId = parseEsliteExhibitionUrl(rawInput);
    const url = exhibitionUrl(exhibitionId);
    const existing = db.findEsliteSubscription({ user_id: userId, target_id: targetId, exhibition_id: exhibitionId });
    if (existing) {
      return { status: 'exists', message: `⚠️ 這個誠品展覽已經在追蹤中了（ID: eslite-${existing.id}）` };
    }
    const subId = db.addEsliteSubscription({
      user_id: userId,
      target_id: targetId,
      target_type: targetType,
      exhibition_id: exhibitionId,
      guild_id: guildId || '',
    });
    return {
      status: 'success',
      platformName: '📗 誠品線上',
      title: `展覽 ID: \`${exhibitionId}\``,
      canonicalUrl: url,
      id: `eslite-${subId}`,
    };
  }

  if (platform === 'shop') {
    const categoryUrl = parseShopCategoryInput(rawInput);
    const existing = db.findShopSubscription({ user_id: userId, target_id: targetId, category_url: categoryUrl });
    if (existing) {
      return { status: 'exists', message: `⚠️ 這個 Funbox 分類已經在追蹤中了（ID: shop-${existing.id}）` };
    }
    const subId = db.addShopSubscription({
      user_id: userId,
      target_id: targetId,
      target_type: targetType,
      category_url: categoryUrl,
      guild_id: guildId || '',
    });
    return {
      status: 'success',
      platformName: '🏬 Funbox 商店',
      title: `分類: \`${categoryUrl}\``,
      canonicalUrl: categoryUrl,
      id: `shop-${subId}`,
    };
  }

  if (platform === 'thread') {
    const articleUrl = normalizeArticleUrl(rawInput);
    const existing = db.findThreadSubscription({ user_id: userId, target_id: targetId, article_url: articleUrl, keyword: '' });
    if (existing) {
      return { status: 'exists', message: `⚠️ 這個 PTT 置底貼文已經在追蹤中了（ID: thread-${existing.id}）` };
    }
    const subId = db.addThreadSubscription({
      user_id: userId,
      target_id: targetId,
      target_type: targetType,
      article_url: articleUrl,
      keyword: '',
      guild_id: guildId || '',
    });
    return {
      status: 'success',
      platformName: '💬 PTT 置底貼文推文監控',
      title: `文章: \`${articleUrl}\``,
      canonicalUrl: articleUrl,
      id: `thread-${subId}`,
    };
  }

  throw new Error('不支援的平台');
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName('watch')
    .setDescription('全平台商品與補貨追蹤（支援蝦皮、momo、誠品、Funbox 自動識別）')
    .addSubcommand(sub =>
      sub
        .setName('add')
        .setDescription('自動識別網址並新增追蹤（支援蝦皮/momo/誠品/Funbox）')
        .addStringOption(opt =>
          opt.setName('url').setDescription('商品或分類網址').setRequired(true)
        )
    )
    .addSubcommand(sub =>
      sub
        .setName('shopee')
        .setDescription('新增蝦皮 (Shopee) 賣場/關鍵字商品追蹤')
        .addStringOption(opt => opt.setName('url').setDescription('蝦皮商品或搜尋網址').setRequired(true))
    )
    .addSubcommand(sub =>
      sub
        .setName('momo')
        .setDescription('新增 momo 購物網分類/旗艦館追蹤')
        .addStringOption(opt => opt.setName('url').setDescription('momo 分類或旗艦館網址').setRequired(true))
    )
    .addSubcommand(sub =>
      sub
        .setName('eslite')
        .setDescription('新增誠品線上展覽追蹤')
        .addStringOption(opt => opt.setName('url').setDescription('誠品展覽網址').setRequired(true))
    )
    .addSubcommand(sub =>
      sub
        .setName('funbox')
        .setDescription('新增 Funbox 商店分類追蹤')
        .addStringOption(opt => opt.setName('url').setDescription('Funbox 分類頁面網址').setRequired(true))
    )
    .addSubcommand(sub =>
      sub
        .setName('list')
        .setDescription('列出目前在該頻道/私訊的全平台追蹤清單')
    )
    .addSubcommand(sub =>
      sub
        .setName('remove')
        .setDescription('移除一筆追蹤（使用 /list 顯示的全區編號，例如 1 或 shopee-1）')
        .addStringOption(opt => opt.setName('id').setDescription('全區編號 (例如 1) 或平台 ID (例如 shopee-1)').setRequired(true))
    ),

  async execute(interaction) {
    const sub = interaction.options.getSubcommand();
    const isDM = !interaction.guildId;
    const targetId = isDM ? interaction.user.id : interaction.channelId;
    const targetType = isDM ? 'dm' : 'channel';
    const userId = interaction.user.id;

    if (sub === 'list') {
      const listCmd = require('./list');
      return listCmd.execute(interaction);
    }

    if (sub === 'remove') {
      const unsubCmd = require('./unsubscribe');
      return unsubCmd.execute(interaction);
    }

    const rawInput = interaction.options.getString('url', true);

    let platform = null;
    if (sub === 'add') {
      platform = detectPlatform(rawInput);
      if (!platform) {
        return interaction.reply({
          content: [
            '❌ 無法自動辨識該網址所屬平台，請確認網址格式正確。',
            '',
            '支援的平台網址範例：',
            '• **蝦皮 Shopee**：`https://shopee.tw/search?keyword=戰鬥陀螺&shop=11664018`',
            '• **momo 購物網**：`https://www.momoshop.com.tw/TP/TP0002451/search?keyword=戰鬥陀螺`',
            '• **誠品線上**：`https://www.eslite.com/exhibitions/12345`',
            '• **Funbox 商店**：`https://shop.funbox.com.tw/categories/XI/KB`',
          ].join('\n'),
          flags: [MessageFlags.Ephemeral],
        });
      }
    } else {
      platform = sub;
      if (platform === 'funbox') platform = 'shop';
    }

    try {
      const result = handleAddByPlatform(platform, rawInput, userId, targetId, targetType, interaction.guildId);

      if (result.status === 'exists') {
        return interaction.reply({
          content: result.message,
          flags: [MessageFlags.Ephemeral],
        });
      }

      return interaction.reply({
        content: [
          `✅ **已成功新增補貨追蹤！**`,
          ``,
          `📌 平台：${result.platformName}`,
          `🎯 目標：${result.title}`,
          `🔗 網址：${result.canonicalUrl}`,
          `🆔 訂閱 ID：\`${result.id}\``,
          `📍 通知管道：${isDM ? '🔐 私訊 (DM)' : `<#${targetId}>`}`,
          ``,
          `當該項目有商品補貨或新上架時，Bot 將第一時間通知您！`,
        ].join('\n'),
      });
    } catch (err) {
      return interaction.reply({
        content: `❌ 新增追蹤失敗：${err.message}`,
        flags: [MessageFlags.Ephemeral],
      });
    }
  },
};
