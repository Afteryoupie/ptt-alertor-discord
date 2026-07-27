'use strict';

const { EmbedBuilder } = require('discord.js');

/**
 * Build a Discord embed for a single PTT article match.
 */
function buildArticleEmbed(article, board, matchType, matchValue) {
  return new EmbedBuilder()
    .setColor(0x00b4d8)
    .setTitle(`📢 [${board}] ${article.title}`)
    .setURL(article.url)
    .addFields(
      { name: '作者', value: article.author || '(未知)', inline: true },
      { name: '追蹤條件', value: `${matchType === 'keyword' ? '🔑 關鍵字' : '👤 作者'}: \`${matchValue}\``, inline: true },
    )
    .setFooter({ text: `PTT • ${board}` })
    .setTimestamp();
}

/**
 * Build a Discord embed for a shop restock event.
 * @param {{ handle, title, url, previousQty, currentQty, sku, isNewProduct }} restock
 * @param {string} categoryUrl
 */
function buildRestockEmbed(restock, categoryUrl) {
  const qtyText = restock.currentQty > 0 ? `${restock.currentQty} 件` : '有貨';
  const label = restock.isNewProduct ? '🆕 新商品上架' : '🔔 補貨通知';

  return new EmbedBuilder()
    .setColor(restock.isNewProduct ? 0xf5a623 : 0x2ecc71)
    .setTitle(`${label}｜${restock.title}`)
    .setURL(restock.url)
    .addFields(
      { name: 'SKU', value: restock.sku || restock.handle, inline: true },
      { name: '目前庫存', value: qtyText, inline: true },
    )
    .setFooter({ text: `Funbox Shop • ${categoryUrl}` })
    .setTimestamp();
}

/**
 * Build a Discord embed for an Eslite exhibition restock event.
 * @param {{ guid, name, url, prevStock, currStock, status, isNewProduct }} restock
 * @param {string} exhibitionId
 */
function buildEsliteRestockEmbed(restock, exhibitionId) {
  const stockLabel = restock.currStock === -1 ? '補貨中（可訂購）' : `${restock.currStock} 件`;
  const label = restock.isNewProduct ? '🆕 新商品上架' : '🔔 補貨通知';
  const exhibitionLink = `https://www.eslite.com/exhibitions/${exhibitionId}`;

  return new EmbedBuilder()
    .setColor(restock.isNewProduct ? 0xf5a623 : 0x2ecc71)
    .setTitle(`${label}｜${restock.name}`)
    .setURL(restock.url)
    .addFields(
      { name: '目前庫存', value: stockLabel, inline: true },
      { name: '直接購買', value: `[點此前往商品頁](${restock.url})`, inline: true },
    )
    .setFooter({ text: `誠品線上 • ${exhibitionId}` })
    .setTimestamp();
}

/**
 * Build a Discord embed for a momo restock / on-sale / coming-soon event.
 * @param {{ goodsCode, name, url, stock, onSaleDescription, status, prevStatus, eventType }} event
 * @param {string} categoryUrl
 */
function buildMomoRestockEmbed(event, categoryUrl) {
  const EVENT_LABELS = {
    restock:     '🔔 momo 補貨通知',
    on_sale:     '🚀 momo 正式開賣！',
    coming_soon: '⏳ momo 即將開賣公告',
    new_product: '🆕 momo 新商品上架',
  };
  const EVENT_COLORS = {
    restock:     0x2ecc71,   // green
    on_sale:     0xe74c3c,   // red (urgent)
    coming_soon: 0xf5a623,   // orange
    new_product: 0x9b59b6,   // purple
  };

  const label = EVENT_LABELS[event.eventType] || '🔔 momo 通知';
  const color = EVENT_COLORS[event.eventType] || 0x2ecc71;

  const stockValue = event.status === 'coming_soon'
    ? `即將開賣：${event.onSaleDescription || '(時間待確認)'}`
    : (event.stock > 0 ? `${event.stock} 件` : '有貨');

  return new EmbedBuilder()
    .setColor(color)
    .setTitle(`${label}｜${event.name}`)
    .setURL(event.url)
    .addFields(
      { name: '狀態', value: stockValue, inline: true },
      { name: '直接購買', value: `[點此前往商品頁](${event.url})`, inline: true },
    )
    .setFooter({ text: `momo 購物網 • ${categoryUrl}` })
    .setTimestamp();
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Resolve a Discord sendable (channel or DM) from a targetId/targetType.
 * @returns {Promise<import('discord.js').TextChannel|import('discord.js').DMChannel|null>}
 */
async function resolveSendable(client, targetId, targetType) {
  if (targetType === 'channel') {
    return client.channels.fetch(targetId).catch(() => null);
  }
  const user = await client.users.fetch(targetId).catch(() => null);
  return user ? user.createDM().catch(() => null) : null;
}

/**
 * Send a batch of Discord embeds to a resolved target, chunked at 10.
 * @param {object} sendable  Discord channel/DM
 * @param {import('discord.js').EmbedBuilder[]} embeds
 */
async function sendEmbeds(sendable, embeds) {
  const MAX = 10;
  for (let i = 0; i < embeds.length; i += MAX) {
    await sendable.send({ embeds: embeds.slice(i, i + MAX) });
    if (i + MAX < embeds.length) await sleep(50);
  }
}

/**
 * Generic notification dispatcher.
 * @param {import('discord.js').Client} client
 * @param {Array<object>} matches  each must have targetId, targetType
 * @param {function(object): import('discord.js').EmbedBuilder} buildEmbed  called per match
 * @param {string} logTag  e.g. '[notifier]'
 */
async function sendMatchNotifications(client, matches, buildEmbed, logTag = '[notifier]') {
  if (!matches.length) return;

  // Group by targetId
  const byTarget = new Map();
  for (const m of matches) {
    if (!byTarget.has(m.targetId)) byTarget.set(m.targetId, []);
    byTarget.get(m.targetId).push(m);
  }

  for (const [targetId, items] of byTarget) {
    try {
      const sendable = await resolveSendable(client, targetId, items[0].targetType);
      if (!sendable) {
        console.warn(`${logTag} Cannot resolve target ${targetId}, skipping`);
        continue;
      }
      await sendEmbeds(sendable, items.map(buildEmbed));
    } catch (err) {
      console.error(`${logTag} Failed to send to ${targetId}:`, err.message);
    }
  }
}

/** Send PTT article notifications. */
function sendNotifications(client, matches) {
  return sendMatchNotifications(
    client, matches,
    m => buildArticleEmbed(m.article, m.board, m.matchType, m.matchValue),
    '[notifier]'
  );
}

/** Send Funbox shop restock notifications. */
function sendRestockNotifications(client, matches) {
  return sendMatchNotifications(
    client, matches,
    m => buildRestockEmbed(m.restock, m.categoryUrl, m.autobuyResult ?? null),
    '[notifier]'
  );
}

/** Send Eslite exhibition restock notifications. */
function sendEsliteRestockNotifications(client, matches) {
  return sendMatchNotifications(
    client, matches,
    m => buildEsliteRestockEmbed(m.restock, m.exhibitionId),
    '[notifier]'
  );
}

/** Send Momo category restock / on-sale / coming-soon notifications. */
function sendMomoRestockNotifications(client, matches) {
  return sendMatchNotifications(
    client, matches,
    m => buildMomoRestockEmbed(m.event, m.categoryUrl),
    '[momo]'
  );
}

function buildShopeeEmbed(change) {
  return new EmbedBuilder()
    .setColor(0xee4d2d) // Shopee Orange
    .setTitle(change.title)
    .setDescription(change.description)
    .setURL(change.url)
    .setFooter({ text: '蝦皮 (Shopee) 追蹤通知' })
    .setTimestamp();
}

/** Send Shopee restock / new item / change notifications. */
function sendShopeeRestockNotifications(client, matches) {
  return sendMatchNotifications(
    client, matches,
    m => buildShopeeEmbed(m.change),
    '[shopee]'
  );
}

module.exports = {
  sendNotifications,
  sendRestockNotifications,
  sendEsliteRestockNotifications,
  sendMomoRestockNotifications,
  sendShopeeRestockNotifications,
};
