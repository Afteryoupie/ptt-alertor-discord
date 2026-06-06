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
 * Send notifications for a batch of matched articles to their targets.
 * Groups by target to send as few API calls as possible.
 *
 * @param {import('discord.js').Client} client
 * @param {Array<{ article, board, matchType, matchValue, targetId, targetType }>} matches
 */
async function sendNotifications(client, matches) {
  if (!matches.length) return;

  // Group matches by targetId
  const byTarget = new Map();
  for (const m of matches) {
    if (!byTarget.has(m.targetId)) byTarget.set(m.targetId, []);
    byTarget.get(m.targetId).push(m);
  }

  for (const [targetId, items] of byTarget) {
    try {
      // Resolve channel or DM
      let sendable;
      const firstItem = items[0];

      if (firstItem.targetType === 'channel') {
        sendable = await client.channels.fetch(targetId).catch(() => null);
      } else {
        // DM: fetch user then create DM channel
        const user = await client.users.fetch(targetId).catch(() => null);
        if (user) sendable = await user.createDM().catch(() => null);
      }

      if (!sendable) {
        console.warn(`[notifier] Cannot resolve target ${targetId}, skipping`);
        continue;
      }

      // Batch: split into groups of 10 embeds (Discord limit per message)
      const MAX_EMBEDS = 10;
      for (let i = 0; i < items.length; i += MAX_EMBEDS) {
        const chunk = items.slice(i, i + MAX_EMBEDS);
        const embeds = chunk.map(m =>
          buildArticleEmbed(m.article, m.board, m.matchType, m.matchValue)
        );

        await sendable.send({ embeds });

        // Polite rate-limit buffer between batches (50ms)
        if (i + MAX_EMBEDS < items.length) {
          await sleep(50);
        }
      }
    } catch (err) {
      console.error(`[notifier] Failed to send to ${targetId}:`, err.message);
    }
  }
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Send shop restock notifications for a batch of restock events to their targets.
 *
 * @param {import('discord.js').Client} client
 * @param {Array<{ restock, categoryUrl, targetId, targetType }>} matches
 */
async function sendRestockNotifications(client, matches) {
  if (!matches.length) return;

  // Group matches by targetId
  const byTarget = new Map();
  for (const m of matches) {
    if (!byTarget.has(m.targetId)) byTarget.set(m.targetId, []);
    byTarget.get(m.targetId).push(m);
  }

  for (const [targetId, items] of byTarget) {
    try {
      let sendable;
      const firstItem = items[0];

      if (firstItem.targetType === 'channel') {
        sendable = await client.channels.fetch(targetId).catch(() => null);
      } else {
        const user = await client.users.fetch(targetId).catch(() => null);
        if (user) sendable = await user.createDM().catch(() => null);
      }

      if (!sendable) {
        console.warn(`[notifier] Cannot resolve target ${targetId}, skipping`);
        continue;
      }

      const MAX_EMBEDS = 10;
      for (let i = 0; i < items.length; i += MAX_EMBEDS) {
        const chunk = items.slice(i, i + MAX_EMBEDS);
        const embeds = chunk.map(m =>
          buildRestockEmbed(m.restock, m.categoryUrl)
        );
        await sendable.send({ embeds });
        if (i + MAX_EMBEDS < items.length) await sleep(50);
      }
    } catch (err) {
      console.error(`[notifier] Failed to send restock to ${targetId}:`, err.message);
    }
  }
}

module.exports = { sendNotifications, sendRestockNotifications };
