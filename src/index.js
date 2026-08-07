'use strict';

require('dotenv').config();

const { Client, GatewayIntentBits, Collection, MessageFlags } = require('discord.js');
const path = require('path');
const fs = require('fs');

const db = require('./database');
const { crawlBoard, matchKeyword, matchAuthor } = require('./scraper');
const { crawlArticle, matchPushKeyword } = require('./thread-scraper');
const { sendNotifications, sendRestockNotifications, sendEsliteRestockNotifications, sendMomoRestockNotifications, sendShopeeRestockNotifications, sendThreadPushNotifications } = require('./notifier');
const {
  snapshotCategory,
  detectRestocks,
  serializeSnapshot,
  deserializeSnapshot,
} = require('./shop-scraper');
const {
  snapshotExhibition,
  detectRestocks: detectEsliteRestocks,
  serializeSnapshot: serializeEsliteSnapshot,
  deserializeSnapshot: deserializeEsliteSnapshot,
  exhibitionUrl,
} = require('./eslite-scraper');
const {
  parseCategoryInput,
  categoryUrl: momoCategoryUrl,
  snapshotCategory: snapshotMomoCategory,
  detectRestocks: detectMomoRestocks,
  serializeSnapshot: serializeMomoSnapshot,
  deserializeSnapshot: deserializeMomoSnapshot,
} = require('./momo-scraper');
const {
  snapshotShopeeSearch,
  detectShopeeChanges,
} = require('./shopee-scraper');

// ─── Configuration ───────────────────────────────────────────────────────────

const TOKEN = process.env.DISCORD_TOKEN;
const COOLDOWN_MS = parseInt(process.env.COOLDOWN_MS || '5000', 10); // 5s between boards

// ENV fallback defaults (used when DB has no override)
const ENV_INTERVALS = {
  poll_interval_ms: parseInt(process.env.POLL_INTERVAL_MS || '300000', 10),
  thread_poll_interval_ms: parseInt(process.env.THREAD_POLL_INTERVAL_MS || '180000', 10), // 3 min
  shop_poll_interval_ms: parseInt(process.env.SHOP_POLL_INTERVAL_MS || '300000', 10),
  eslite_poll_interval_ms: parseInt(process.env.ESLITE_POLL_INTERVAL_MS || '300000', 10),
  momo_poll_interval_ms: parseInt(process.env.MOMO_POLL_INTERVAL_MS || '300000', 10),
  shopee_poll_interval_ms: parseInt(process.env.SHOPEE_POLL_INTERVAL_MS || '300000', 10),
};

if (!TOKEN) {
  console.error('[startup] ❌ DISCORD_TOKEN is not set. Please create a .env file.');
  process.exit(1);
}

// ─── Discord Client ───────────────────────────────────────────────────────────

const client = new Client({
  intents: [GatewayIntentBits.Guilds],
  // Disable unused caches to reduce memory footprint
  makeCache: require('discord.js').Options.cacheWithLimits({
    MessageManager: 0,
    PresenceManager: 0,
    GuildMemberManager: 200,
  }),
});

// ─── Load Commands ────────────────────────────────────────────────────────────

client.commands = new Collection();
const commandsDir = path.join(__dirname, 'commands');

for (const file of fs.readdirSync(commandsDir).filter(f => f.endsWith('.js'))) {
  const cmd = require(path.join(commandsDir, file));
  client.commands.set(cmd.data.name, cmd);
}

// Expose cross-tick dedup helper so commands (e.g. /subscribe) can register
// instant-verification notifications and prevent the background scraper from
// sending them again.
client.markAsNotified = function (targetId, articleAid) {
  markAsNotified(targetId, articleAid);
};

// ─── Event Handlers ───────────────────────────────────────────────────────────

client.once('clientReady', () => {
  console.log(`[startup] ✅ Logged in as ${client.user.tag}`);

  const getOpHours = (key) => `${db.getSetting(key + '_op_hour_start') || '10'}:00-${db.getSetting(key + '_op_hour_end') || '19'}:00`;

  console.log(`[startup] 🕒 PTT interval:    min ${db.getMinIntervalMsAcrossGuilds('poll_interval_ms', ENV_INTERVALS.poll_interval_ms) / 1000}s (varies by guild) (${getOpHours('ptt')})`);
  console.log(`[startup] 💬 Thread interval: min ${db.getMinIntervalMsAcrossGuilds('thread_poll_interval_ms', ENV_INTERVALS.thread_poll_interval_ms) / 1000}s (${getOpHours('ptt')})`);
  console.log(`[startup] 🛒 Shop interval:   min ${db.getMinIntervalMsAcrossGuilds('shop_poll_interval_ms', ENV_INTERVALS.shop_poll_interval_ms) / 1000}s (${getOpHours('shop')})`);
  console.log(`[startup] 🏬 Eslite interval: min ${db.getMinIntervalMsAcrossGuilds('eslite_poll_interval_ms', ENV_INTERVALS.eslite_poll_interval_ms) / 1000}s (${getOpHours('eslite')})`);
  console.log(`[startup] 🛍️  Momo interval:  min ${db.getMinIntervalMsAcrossGuilds('momo_poll_interval_ms', ENV_INTERVALS.momo_poll_interval_ms) / 1000}s (${getOpHours('momo')})`);
  console.log(`[startup] 🟠 Shopee interval: min ${db.getMinIntervalMsAcrossGuilds('shopee_poll_interval_ms', ENV_INTERVALS.shopee_poll_interval_ms) / 1000}s (${getOpHours('shopee')})`);
  startScraperLoop();
  startThreadScraperLoop();
  startShopScraperLoop();
  startEsliteScraperLoop();
  startMomoScraperLoop();
  startShopeeScraperLoop();
});

client.on('interactionCreate', async interaction => {
  if (interaction.isChatInputCommand()) {
    const cmd = client.commands.get(interaction.commandName);
    if (!cmd) return;

    try {
      await cmd.execute(interaction);
    } catch (err) {
      console.error(`[commands] Error in /${interaction.commandName}:`, err);
      const msg = { content: '❌ 指令執行發生錯誤，請稍後再試。', flags: [MessageFlags.Ephemeral] };
      if (interaction.replied || interaction.deferred) {
        await interaction.followUp(msg).catch(() => { });
      } else {
        await interaction.reply(msg).catch(() => { });
      }
    }
  } else if (interaction.isAutocomplete()) {
    const cmd = client.commands.get(interaction.commandName);
    if (!cmd || !cmd.autocomplete) return;

    try {
      await cmd.autocomplete(interaction);
    } catch (err) {
      console.error(`[autocomplete] Error in /${interaction.commandName}:`, err);
    }
  }
});

// ─── Cross-tick Deduplication ─────────────────────────────────────────────────

/**
 * Module-level Set to prevent duplicate notifications across ticks and
 * between /subscribe instant verification and the background scraper.
 * Key format: "targetId-articleAid"
 * Entries auto-expire after 1 hour based on AID timestamp.
 */
const recentlyNotified = new Set();
const RECENTLY_NOTIFIED_TTL_MS = 3600_000; // 1 hour

/**
 * Add a targetId+articleAid pair to the recently-notified set.
 * Called by both the scraper loop and /subscribe instant verification.
 */
function markAsNotified(targetId, articleAid) {
  recentlyNotified.add(`${targetId}-${articleAid}`);
}

/**
 * Check if a targetId+articleAid pair was recently notified.
 */
function wasRecentlyNotified(targetId, articleAid) {
  return recentlyNotified.has(`${targetId}-${articleAid}`);
}

/**
 * Purge entries older than TTL by extracting the Unix timestamp from the AID.
 * AID format: M.XXXXXXXXXX.A.XXX (XXXXXXXXXX is Unix epoch seconds)
 */
function purgeExpiredNotifications() {
  const nowSec = Math.floor(Date.now() / 1000);
  const ttlSec = RECENTLY_NOTIFIED_TTL_MS / 1000;
  for (const key of recentlyNotified) {
    const aidPart = key.split('-').slice(1).join('-'); // targetId may contain '-'
    const tsMatch = /^M\.(\d+)\./.exec(aidPart);
    if (tsMatch) {
      const aidTs = parseInt(tsMatch[1], 10);
      if (nowSec - aidTs > ttlSec) recentlyNotified.delete(key);
    }
  }
}

// ─── Scraper Loop ─────────────────────────────────────────────────────────────

/**
 * Core scraper loop:
 * 1. Fetch all subscribed boards (distinct)
 * 2. For each board: crawl PTT, find new articles PER GUILD
 * 3. Each guild has its own interval and last_aid tracking
 * 4. Collect per-guild matches and send notifications
 * 5. Wait for the minimum interval across all guilds, then repeat
 */
function startScraperLoop() {
  let running = false;

  async function tick() {
    if (running) {
      console.warn('[scraper] Previous cycle still running, skipping tick.');
      return;
    }

    if (!isWithinOperatingHours('ptt')) {
      console.log(`[ptt] ⏰ 目前非設定的營業時間，跳過循環。`);
      return;
    }

    running = true;

    try {
      const boards = db.getAllBoards();
      if (!boards.length) {
        console.log('[scraper] 目前沒有任何訂閱，跳過循環。');
        return;
      }

      console.log(`[scraper] === 開始掃描循環 (${boards.length} 個看板) ===`);
      const allMatches = [];
      const now = Date.now();

      for (const board of boards) {
        try {
          // Crawl board once; reuse allArticles for all guilds
          const { allArticles, currentNewestAid } = await crawlBoard(board);
          const guilds = db.getDistinctGuildsForBoard(board);

          for (const guildId of guilds) {
            const guildInterval = db.getGuildIntervalMs(
              guildId,
              'poll_interval_ms',
              ENV_INTERVALS.poll_interval_ms
            );
            // guild_id = '' (legacy) 無法用 getGuildSetting 讀寫，改用全域 key fallback
            const lastCheckKey = guildId ? `guild:${guildId}:ptt_last_check` : 'ptt_last_check';
            const lastCheckMs = parseInt(db.getSetting(lastCheckKey) || '0', 10);

            // Skip guilds that are not due for a check yet
            if (now - lastCheckMs < guildInterval) continue;

            const guildLastAid = db.getGuildBoardState(guildId, board);

            // First time this guild has seen this board — anchor and skip notifications
            if (!guildLastAid) {
              if (currentNewestAid) db.setGuildBoardState(guildId, board, currentNewestAid);
              db.setSetting(lastCheckKey, String(now));
              continue;
            }

            const guildNewArticles = allArticles.filter(a => a.aid > guildLastAid);

            if (guildNewArticles.length > 0) {
              const subs = db.getSubsForBoardAndGuild(board, guildId);
              console.log(`[scraper] [${board}] [guild:${guildId || 'global'}] 發現 ${guildNewArticles.length} 篇新文章，比對 ${subs.length} 筆訂閱中…`);

              // 以 target_id + article.aid 去重：
              // 確保同一個頻道對同一篇文章只發一則通知，
              // 不論有幾條 keyword 訂閱同時符合
              const notifiedInThisCycle = new Set();
              for (const article of guildNewArticles) {
                for (const sub of subs) {
                  const dupKey = `${sub.target_id}-${article.aid}`;
                  if (notifiedInThisCycle.has(dupKey)) continue;

                  let matched = false;
                  if (sub.type === 'keyword') matched = matchKeyword(article.title, sub.match_value);
                  else if (sub.type === 'author') matched = matchAuthor(article.author, sub.match_value);

                  if (matched) {
                    allMatches.push({
                      article,
                      board,
                      matchType: sub.type,
                      matchValue: sub.match_value,
                      targetId: sub.target_id,
                      targetType: sub.target_type,
                    });
                    notifiedInThisCycle.add(dupKey);
                  }
                }
              }
            }

            // Update guild board state and last check timestamp
            // 只往前更新，防止刪文後 currentNewestAid 回退導致重複通知
            if (currentNewestAid && (!guildLastAid || currentNewestAid > guildLastAid)) {
              db.setGuildBoardState(guildId, board, currentNewestAid);
            }
            db.setSetting(lastCheckKey, String(now));
          }
        } catch (err) {
          console.error(`[scraper] Error crawling ${board}:`, err.message);
        }

        // Polite cooldown between board requests
        if (boards.length > 1) {
          await sleep(COOLDOWN_MS);
        }
      }

      // Cross-tick dedup: filter out articles already notified by /subscribe or previous tick
      purgeExpiredNotifications();
      const dedupedMatches = allMatches.filter(m => {
        if (wasRecentlyNotified(m.targetId, m.article.aid)) {
          console.log(`[scraper] ⏭️ 跳過已通知: ${m.targetId} ← ${m.article.aid}`);
          return false;
        }
        return true;
      });

      // Send all collected notifications
      if (dedupedMatches.length) {
        console.log(`[scraper] 🚀 成功匹配！正在發送 ${dedupedMatches.length} 則通知…`);
        await sendNotifications(client, dedupedMatches);
        // Mark as notified for future dedup
        for (const m of dedupedMatches) {
          markAsNotified(m.targetId, m.article.aid);
        }
      }

      console.log(`[scraper] === 循環結束 (${new Date().toLocaleTimeString('zh-TW')}) ===`);
    } catch (err) {
      console.error('[scraper] Unexpected error in tick:', err);
    } finally {
      running = false;
    }
  }

  // Dynamic setTimeout: re-reads interval from DB after every tick.
  // This allows /config interval-set to take effect without restarting the bot.
  async function schedule() {
    await tick();
    const interval = db.getIntervalMs('poll_interval_ms', ENV_INTERVALS.poll_interval_ms);
    console.log(`[scraper] ⏳ 下次掃描於 ${interval / 1000}s 後。`);
    setTimeout(schedule, interval);
  }

  schedule();
}

// ─── PTT Thread (Push) Monitoring Loop ───────────────────────────────────────

/**
 * PTT thread push monitoring loop:
 * 1. Fetch all subscribed PTT article URLs
 * 2. Crawl pushes and current poll offset for each article
 * 3. Compare with stored state (pollOffset, pushCount)
 * 4. Filter new pushes against subscriber keywords
 * 5. Send notifications and update state
 */
function startThreadScraperLoop() {
  let running = false;

  async function tick() {
    if (running) {
      console.warn('[thread] Previous cycle still running, skipping tick.');
      return;
    }

    if (!isWithinOperatingHours('ptt')) {
      console.log(`[thread] ⏰ 目前非設定的營業時間，跳過循環。`);
      return;
    }

    running = true;

    try {
      const articleUrls = db.getAllThreadArticles();
      if (!articleUrls.length) return;

      console.log(`[thread] === 開始掃描 PTT 文章推文 (${articleUrls.length} 篇文章) ===`);
      const allMatches = [];

      for (const articleUrl of articleUrls) {
        try {
          const { pushes, pollOffset } = await crawlArticle(articleUrl);
          const prevState = db.getThreadState(articleUrl);

          if (!prevState) {
            // First time seeing this article: save baseline, no notifications
            console.log(`[thread] [${articleUrl}] 首次掃描，儲存基準 (Offset: ${pollOffset}, Pushes: ${pushes.length})。`);
            db.upsertThreadState(articleUrl, pollOffset, pushes.length);
            continue;
          }

          // Check if there are new pushes:
          // New pushes exist if pollOffset changed OR push count increased
          const offsetChanged = pollOffset && pollOffset !== prevState.poll_offset;
          const countIncreased = pushes.length > prevState.push_count;

          if (offsetChanged || countIncreased) {
            // Calculate new pushes index: if count increased, slice from previous count
            const prevCount = prevState.push_count;
            const newPushes = pushes.slice(prevCount);

            if (newPushes.length > 0) {
              const subs = db.getThreadSubsForArticle(articleUrl);
              console.log(`[thread] [${articleUrl}] 發現 ${newPushes.length} 則新推文，比對 ${subs.length} 筆訂閱中…`);

              for (const push of newPushes) {
                for (const sub of subs) {
                  if (!sub.keyword || matchPushKeyword(push.content, sub.keyword)) {
                    allMatches.push({
                      push,
                      articleUrl,
                      keyword: sub.keyword,
                      targetId: sub.target_id,
                      targetType: sub.target_type,
                      userId: sub.user_id,
                    });
                  }
                }
              }
            }

            // Update state
            db.upsertThreadState(articleUrl, pollOffset, pushes.length);
          } else {
            console.log(`[thread] [${articleUrl}] 無新推文。`);
          }
        } catch (err) {
          console.error(`[thread] Error crawling ${articleUrl}:`, err.message);
        }

        if (articleUrls.length > 1) await sleep(COOLDOWN_MS);
      }

      if (allMatches.length) {
        console.log(`[thread] 🚀 發送 ${allMatches.length} 則新推文通知...`);
        await sendThreadPushNotifications(client, allMatches);
      }

      console.log(`[thread] === 循環結束 (${new Date().toLocaleTimeString('zh-TW')}) ===`);
    } catch (err) {
      console.error('[thread] Unexpected error in tick:', err);
    } finally {
      running = false;
    }
  }

  async function schedule() {
    await tick();
    const interval = db.getMinIntervalMsAcrossGuilds('thread_poll_interval_ms', ENV_INTERVALS.thread_poll_interval_ms);
    console.log(`[thread] ⏳ 下次掃描於 ${interval / 1000}s 後。`);
    setTimeout(schedule, interval);
  }

  schedule();
}

// ─── Shop Restock Scraper Loop ────────────────────────────────────────────────

/**
 * Core shop restock loop:
 * 1. Fetch all subscribed shop category URLs (distinct)
 * 2. For each category: fetch current inventory snapshot from Funbox JSON API
 * 3. Compare against stored snapshot to detect restocks
 * 4. Notify subscribed channels/DMs and save updated snapshot
 * 5. Wait SHOP_POLL_INTERVAL ms, then repeat
 */
function startShopScraperLoop() {
  let running = false;

  async function tick() {
    if (running) {
      console.warn('[shop] Previous cycle still running, skipping tick.');
      return;
    }

    if (!isWithinOperatingHours('shop')) {
      console.log(`[shop] ⏰ 目前非設定的營業時間，跳過循環。`);
      return;
    }

    running = true;

    try {
      const categories = db.getAllShopCategories();
      if (!categories.length) {
        // No shop subscriptions yet — silent
        return;
      }

      console.log(`[shop] === 開始掃描商品庫存 (${categories.length} 個分類) ===`);
      const allRestockMatches = [];

      for (const categoryUrl of categories) {
        try {
          // categoryUrl is the full URL string stored in DB
          // Extract the path portion for the API call (e.g. "XI/KB")
          const pathMatch = categoryUrl.match(/categories\/(.+)$/);
          const categoryPath = pathMatch ? pathMatch[1] : categoryUrl;

          // Fetch fresh snapshot
          const currSnapshot = await snapshotCategory(categoryPath);

          if (!currSnapshot || currSnapshot.size === 0) {
            console.warn(`[shop] [${categoryUrl}] ⚠️ 抓取結果為空快照，跳過更新以防誤判庫存變動。`);
            continue;
          }

          // Load previous snapshot
          const prevRaw = db.getShopSnapshot(categoryUrl);
          const prevSnapshot = prevRaw ? deserializeSnapshot(prevRaw) : null;

          if (!prevSnapshot) {
            // First run: just save baseline, no notifications
            console.log(`[shop] [${categoryUrl}] 首次掃描，儲存基準庫存快照。`);
            db.upsertShopSnapshot(categoryUrl, serializeSnapshot(currSnapshot));
            continue;
          }

          // Detect restocks
          const restocks = detectRestocks(prevSnapshot, currSnapshot);

          // Always update snapshot
          db.upsertShopSnapshot(categoryUrl, serializeSnapshot(currSnapshot));

          if (!restocks.length) {
            console.log(`[shop] [${categoryUrl}] 無補貨變動。`);
            continue;
          }

          console.log(`[shop] [${categoryUrl}] 發現 ${restocks.length} 筆補貨！`);

          const subs = db.getShopSubsForCategory(categoryUrl);
          for (const restock of restocks) {
            for (const sub of subs) {
              allRestockMatches.push({
                restock,
                categoryUrl,
                targetId: sub.target_id,
                targetType: sub.target_type,
                userId: sub.user_id,
              });
            }
          }
        } catch (err) {
          console.error(`[shop] Error checking ${categoryUrl}:`, err.message);
        }

        // Polite cooldown between category requests
        if (categories.length > 1) await sleep(COOLDOWN_MS);
      }

      if (allRestockMatches.length) {
        console.log(`[shop] 🚀 發送 ${allRestockMatches.length} 則補貨通知...`);
        await sendRestockNotifications(client, allRestockMatches);
      }

      console.log(`[shop] === 循環結束 (${new Date().toLocaleTimeString('zh-TW')}) ===`);
    } catch (err) {
      console.error('[shop] Unexpected error in tick:', err);
    } finally {
      running = false;
    }
  }

  async function schedule() {
    await tick();
    const interval = db.getMinIntervalMsAcrossGuilds('shop_poll_interval_ms', ENV_INTERVALS.shop_poll_interval_ms);
    console.log(`[shop] ⏳ 下次掃描於 ${interval / 1000}s 後。`);
    setTimeout(schedule, interval);
  }

  schedule();
}

// ─── Eslite Exhibition Restock Scraper Loop ───────────────────────────────────

/**
 * Core eslite exhibition restock loop:
 * 1. Fetch all subscribed eslite exhibition IDs (distinct)
 * 2. For each exhibition: fetch current inventory snapshot from Eslite API
 * 3. Compare against stored snapshot to detect restocks
 * 4. Notify subscribed channels/DMs and save updated snapshot
 * 5. Wait ESLITE_POLL_INTERVAL ms, then repeat
 */
function startEsliteScraperLoop() {
  let running = false;

  async function tick() {
    if (running) {
      console.warn('[eslite] Previous cycle still running, skipping tick.');
      return;
    }

    if (!isWithinOperatingHours('eslite')) {
      console.log(`[eslite] ⏰ 目前非設定的營業時間，跳過循環。`);
      return;
    }

    running = true;

    try {
      const exhibitions = db.getAllEsliteExhibitions();
      if (!exhibitions.length) {
        // No eslite subscriptions yet — silent
        return;
      }

      console.log(`[eslite] === 開始掃描誠品展覽庫存 (${exhibitions.length} 個展覽) ===`);
      const allRestockMatches = [];

      for (const exhibitionId of exhibitions) {
        try {
          // Fetch fresh snapshot
          const currSnapshot = await snapshotExhibition(exhibitionId);

          if (!currSnapshot || currSnapshot.size === 0) {
            console.warn(`[eslite] [${exhibitionId}] ⚠️ 抓取結果為空快照，跳過更新以防誤判庫存變動。`);
            continue;
          }

          // Load previous snapshot
          const prevRaw = db.getEsliteSnapshot(exhibitionId);
          const prevSnapshot = prevRaw ? deserializeEsliteSnapshot(prevRaw) : null;

          if (!prevSnapshot) {
            // First run: save baseline, no notifications
            console.log(`[eslite] [${exhibitionId}] 首次掃描，儲存基準庫存快照。`);
            db.upsertEsliteSnapshot(exhibitionId, serializeEsliteSnapshot(currSnapshot));
            continue;
          }

          // Detect restocks
          const restocks = detectEsliteRestocks(prevSnapshot, currSnapshot);

          // Always update snapshot
          db.upsertEsliteSnapshot(exhibitionId, serializeEsliteSnapshot(currSnapshot));

          if (!restocks.length) {
            console.log(`[eslite] [${exhibitionId}] 無補貨變動。`);
            continue;
          }

          console.log(`[eslite] [${exhibitionId}] 發現 ${restocks.length} 筆補貨！`);

          const subs = db.getEsliteSubsForExhibition(exhibitionId);
          for (const restock of restocks) {
            for (const sub of subs) {
              allRestockMatches.push({
                restock,
                exhibitionId,
                targetId: sub.target_id,
                targetType: sub.target_type,
                userId: sub.user_id,
              });
            }
          }
        } catch (err) {
          console.error(`[eslite] Error checking ${exhibitionId}:`, err.message);
        }

        // Polite cooldown between exhibition requests
        if (exhibitions.length > 1) await sleep(COOLDOWN_MS);
      }

      if (allRestockMatches.length) {
        console.log(`[eslite] 🚀 發送 ${allRestockMatches.length} 則誠品補貨通知...`);
        await sendEsliteRestockNotifications(client, allRestockMatches);
      }

      console.log(`[eslite] === 循環結束 (${new Date().toLocaleTimeString('zh-TW')}) ===`);
    } catch (err) {
      console.error('[eslite] Unexpected error in tick:', err);
    } finally {
      running = false;
    }
  }

  async function schedule() {
    await tick();
    const interval = db.getMinIntervalMsAcrossGuilds('eslite_poll_interval_ms', ENV_INTERVALS.eslite_poll_interval_ms);
    console.log(`[eslite] ⏳ 下次掃描於 ${interval / 1000}s 後。`);
    setTimeout(schedule, interval);
  }

  schedule();
}

// ─── Momo Category Restock Scraper Loop ──────────────────────────────────────

/**
 * Core momo restock loop (runs 24/7 — momo restocks can happen at midnight):
 * 1. Fetch all subscribed momo category URLs (distinct)
 * 2. For each category: fetch current inventory snapshot via POST API (max 2 pages)
 * 3. Compare against stored snapshot to detect restocks / coming-soon events
 * 4. Notify subscribed channels/DMs and save updated snapshot
 * 5. Wait MOMO_POLL_INTERVAL ms, then repeat
 */
function startMomoScraperLoop() {
  let running = false;

  async function tick() {
    if (running) {
      console.warn('[momo] Previous cycle still running, skipping tick.');
      return;
    }

    if (!isWithinOperatingHours('momo')) {
      console.log(`[momo] ⏰ 目前非設定的營業時間，跳過循環。`);
      return;
    }

    running = true;

    try {
      const categories = db.getAllMomoCategories();
      if (!categories.length) {
        // No momo subscriptions yet — silent
        return;
      }

      console.log(`[momo] === 開始掃描 momo 分類庫存 (${categories.length} 個分類) ===`);
      const allEventMatches = [];

      for (const categoryFullUrl of categories) {
        try {
          // Parse cateCode + cateType from the stored canonical URL
          const { cateCode, cateType } = parseCategoryInput(categoryFullUrl);

          // Fetch fresh snapshot (max 2 pages)
          const currSnapshot = await snapshotMomoCategory(cateCode, cateType, 2);

          if (!currSnapshot || currSnapshot.size === 0) {
            console.warn(`[momo] [${categoryFullUrl}] ⚠️ 抓取結果為空快照，跳過更新以防誤判庫存變動。`);
            continue;
          }

          // Load previous snapshot
          const prevRaw = db.getMomoSnapshot(categoryFullUrl);
          const prevSnapshot = prevRaw ? deserializeMomoSnapshot(prevRaw) : null;

          if (!prevSnapshot) {
            // First run: save baseline, no notifications
            console.log(`[momo] [${categoryFullUrl}] 首次掃描，儲存基準庫存快照。`);
            db.upsertMomoSnapshot(categoryFullUrl, serializeMomoSnapshot(currSnapshot));
            continue;
          }

          // Detect events
          const events = detectMomoRestocks(prevSnapshot, currSnapshot);

          // Always update snapshot
          db.upsertMomoSnapshot(categoryFullUrl, serializeMomoSnapshot(currSnapshot));

          if (!events.length) {
            console.log(`[momo] [${categoryFullUrl}] 無變動。`);
            continue;
          }

          console.log(`[momo] [${categoryFullUrl}] 發現 ${events.length} 筆事件！`);

          const subs = db.getMomoSubsForCategory(categoryFullUrl);
          for (const event of events) {
            for (const sub of subs) {
              allEventMatches.push({
                event,
                categoryUrl: categoryFullUrl,
                targetId: sub.target_id,
                targetType: sub.target_type,
                userId: sub.user_id,
              });
            }
          }
        } catch (err) {
          console.error(`[momo] Error checking ${categoryFullUrl}:`, err.message);
        }

        // Polite cooldown between category requests
        if (categories.length > 1) await sleep(COOLDOWN_MS);
      }

      if (allEventMatches.length) {
        console.log(`[momo] 🚀 發送 ${allEventMatches.length} 則 momo 通知...`);
        await sendMomoRestockNotifications(client, allEventMatches);
      }

      console.log(`[momo] === 循環結束 (${new Date().toLocaleTimeString('zh-TW')}) ===`);
    } catch (err) {
      console.error('[momo] Unexpected error in tick:', err);
    } finally {
      running = false;
    }
  }

  async function schedule() {
    await tick();
    const interval = db.getMinIntervalMsAcrossGuilds('momo_poll_interval_ms', ENV_INTERVALS.momo_poll_interval_ms);
    console.log(`[momo] ⏳ 下次掃描於 ${interval / 1000}s 後。`);
    setTimeout(schedule, interval);
  }

  schedule();
}

// ─── Shopee Scraper Loop ──────────────────────────────────────────────────────

function startShopeeScraperLoop() {
  let running = false;

  async function tick() {
    if (running) return;
    if (!isWithinOperatingHours('shopee')) {
      console.log(`[shopee] 💤 目前不在運作時間內，跳過掃描。`);
      return;
    }
    running = true;

    try {
      const searches = db.getAllShopeeSearches();
      if (!searches.length) return;

      console.log(`[shopee] === 開始輪詢 ${searches.length} 個蝦皮追蹤網址 (${new Date().toLocaleTimeString('zh-TW')}) ===`);

      const allChangeMatches = [];

      for (const item of searches) {
        const { search_url, keyword, shop_id } = item;
        const subs = db.getShopeeSubsForSearch(search_url);
        if (!subs.length) continue;

        try {
          const newSnap = await snapshotShopeeSearch({ shopId: shop_id, keyword });
          const oldSnap = db.getShopeeSnapshot(search_url);

          // Guard against transient category fetch failure
          if (keyword && oldSnap && oldSnap.matchedCategory && !newSnap.matchedCategory) {
            console.warn(`[shopee] ⚠️ [${search_url}] 分類擷取暫時失敗，跳過更新快照。`);
            continue;
          }

          db.upsertShopeeSnapshot(search_url, newSnap);

          if (!oldSnap) {
            console.log(`[shopee] 🆕 建立蝦皮快照: ${search_url}`);
            continue;
          }

          const changes = detectShopeeChanges(oldSnap, newSnap);
          if (changes.length) {
            console.log(`[shopee] 🎯 發現 ${changes.length} 項變動: ${search_url}`);
            for (const change of changes) {
              for (const sub of subs) {
                allChangeMatches.push({
                  targetId: sub.target_id,
                  targetType: sub.target_type,
                  change,
                  searchUrl: search_url,
                });
              }
            }
          }
        } catch (err) {
          console.error(`[shopee] ❌ 掃描失敗 ${search_url}:`, err.message);
        }

        await sleep(2000);
      }

      if (allChangeMatches.length) {
        console.log(`[shopee] 🚀 發送 ${allChangeMatches.length} 則蝦皮通知...`);
        await sendShopeeRestockNotifications(client, allChangeMatches);
      }

      console.log(`[shopee] === 循環結束 (${new Date().toLocaleTimeString('zh-TW')}) ===`);
    } catch (err) {
      console.error('[shopee] Unexpected error in tick:', err);
    } finally {
      running = false;
    }
  }

  async function schedule() {
    await tick();
    const interval = db.getMinIntervalMsAcrossGuilds('shopee_poll_interval_ms', ENV_INTERVALS.shopee_poll_interval_ms);
    console.log(`[shopee] ⏳ 下次掃描於 ${interval / 1000}s 後。`);
    setTimeout(schedule, interval);
  }

  schedule();
}

// ─── Graceful Shutdown ────────────────────────────────────────────────────────

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

function shutdown() {
  console.log('[shutdown] Received signal, shutting down gracefully...');
  client.destroy();
  process.exit(0);
}

// ─── Start ────────────────────────────────────────────────────────────────────

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Returns true if current Taiwan time (Asia/Taipei) is within operating hours.
 * Operating hours are configurable via /config hours-set
 * Default for all scrapers is 10:00 - 19:00.
 * @param {string} scraperKey
 * @returns {boolean}
 */
function isWithinOperatingHours(scraperKey) {
  const defaultStart = '10';
  const defaultEnd = '19';

  const startHourStr = db.getSetting(`${scraperKey}_op_hour_start`) || defaultStart;
  const endHourStr = db.getSetting(`${scraperKey}_op_hour_end`) || defaultEnd;
  const startHour = parseInt(startHourStr, 10);
  const endHour = parseInt(endHourStr, 10);

  const now = new Date();
  const hour = parseInt(
    new Intl.DateTimeFormat('en-US', {
      timeZone: 'Asia/Taipei',
      hour: 'numeric',
      hour12: false,
    }).format(now),
    10
  );

  if (startHour <= endHour) {
    // Normal range, e.g., 10 to 19 (inclusive of 10, up to 18:59)
    return hour >= startHour && hour < endHour;
  } else {
    // Overnight range, e.g., 22 to 06
    return hour >= startHour || hour < endHour;
  }
}


client.login(TOKEN).catch(err => {
  console.error('[startup] ❌ Login failed:', err.message);
  process.exit(1);
});
