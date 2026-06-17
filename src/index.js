'use strict';

require('dotenv').config();

const { Client, GatewayIntentBits, Collection, MessageFlags } = require('discord.js');
const path = require('path');
const fs   = require('fs');

const db                  = require('./database');
const { crawlBoard, matchKeyword, matchAuthor } = require('./scraper');
const { sendNotifications, sendRestockNotifications, sendEsliteRestockNotifications, sendMomoRestockNotifications } = require('./notifier');
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
const { buyProduct }   = require('./shop-buyer');
const { decryptCookie } = require('./crypto-utils');

// ─── Configuration ───────────────────────────────────────────────────────────

const TOKEN        = process.env.DISCORD_TOKEN;
const COOLDOWN_MS  = parseInt(process.env.COOLDOWN_MS || '5000', 10); // 5s between boards

// ENV fallback defaults (used when DB has no override)
const ENV_INTERVALS = {
  poll_interval_ms:        parseInt(process.env.POLL_INTERVAL_MS        || '300000', 10),
  shop_poll_interval_ms:   parseInt(process.env.SHOP_POLL_INTERVAL_MS   || '300000', 10),
  eslite_poll_interval_ms: parseInt(process.env.ESLITE_POLL_INTERVAL_MS || '300000', 10),
  momo_poll_interval_ms:   parseInt(process.env.MOMO_POLL_INTERVAL_MS   || '300000', 10),
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
    MessageManager:   0,
    PresenceManager:  0,
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

// ─── Event Handlers ───────────────────────────────────────────────────────────

client.once('clientReady', () => {
  console.log(`[startup] ✅ Logged in as ${client.user.tag}`);
  
  const getOpHours = (key) => `${db.getSetting(key + '_op_hour_start') || '10'}:00-${db.getSetting(key + '_op_hour_end') || '19'}:00`;

  console.log(`[startup] 🕒 PTT interval:    ${db.getIntervalMs('poll_interval_ms',        ENV_INTERVALS.poll_interval_ms) / 1000}s (${getOpHours('ptt')})`);
  console.log(`[startup] 🛒 Shop interval:   ${db.getIntervalMs('shop_poll_interval_ms',   ENV_INTERVALS.shop_poll_interval_ms) / 1000}s (${getOpHours('shop')})`);
  console.log(`[startup] 🏬 Eslite interval: ${db.getIntervalMs('eslite_poll_interval_ms', ENV_INTERVALS.eslite_poll_interval_ms) / 1000}s (${getOpHours('eslite')})`);
  console.log(`[startup] 🛍️  Momo interval:  ${db.getIntervalMs('momo_poll_interval_ms',   ENV_INTERVALS.momo_poll_interval_ms) / 1000}s (${getOpHours('momo')})`);
  startScraperLoop();
  startShopScraperLoop();
  startEsliteScraperLoop();
  startMomoScraperLoop();
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
        await interaction.followUp(msg).catch(() => {});
      } else {
        await interaction.reply(msg).catch(() => {});
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

// ─── Scraper Loop ─────────────────────────────────────────────────────────────

/**
 * Core scraper loop:
 * 1. Fetch all subscribed boards (distinct)
 * 2. For each board: crawl PTT, find new articles, match subscriptions
 * 3. Collect all matches and send notifications in batches
 * 4. Wait POLL_INTERVAL ms, then repeat
 *
 * Key optimization: each board is crawled ONCE regardless of how many
 * users subscribed to it — then all matches are processed in-memory.
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

      for (const board of boards) {
        try {
          const lastAid = db.getBoardState(board);
          const { newArticles, currentNewestAid } = await crawlBoard(board, lastAid);

          // Update board state with newest AID seen (even if no new articles)
          if (currentNewestAid) {
            db.upsertBoardState(board, currentNewestAid);
          }

          if (!newArticles.length) {
            // No new articles since last check
            continue;
          }

          const subs = db.getSubsForBoard(board);
          console.log(`[scraper] [${board}] 發現 ${newArticles.length} 篇新文章，比對 ${subs.length} 筆訂閱中...`);

          // Track (targetId + aid) to avoid duplicate notifications for the same article in one target
          const notifiedInThisCycle = new Set();

          for (const article of newArticles) {
            for (const sub of subs) {
              const dupKey = `${sub.target_id}-${article.aid}`;
              if (notifiedInThisCycle.has(dupKey)) continue;

              let matched = false;

              if (sub.type === 'keyword') {
                matched = matchKeyword(article.title, sub.match_value);
              } else if (sub.type === 'author') {
                matched = matchAuthor(article.author, sub.match_value);
              }

              if (matched) {
                allMatches.push({
                  article,
                  board,
                  matchType:  sub.type,
                  matchValue: sub.match_value,
                  targetId:   sub.target_id,
                  targetType: sub.target_type,
                });
                notifiedInThisCycle.add(dupKey);
              }
            }
          }
        } catch (err) {
          console.error(`[scraper] Error crawling ${board}:`, err.message);
        }

        // Polite cooldown between board requests
        if (boards.length > 1) {
          await sleep(COOLDOWN_MS);
        }
      }

      // Send all collected notifications
      if (allMatches.length) {
        console.log(`[scraper] 🚀 成功匹配！正在發送 ${allMatches.length} 則通知...`);
        await sendNotifications(client, allMatches);
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
              // ── Auto-buy: attempt purchase if user configured a cookie ──
              let autobuyResult = null;
              const autobuyConfig = db.getAutobuyConfig(sub.user_id);

              if (autobuyConfig) {
                const plainCookie = decryptCookie({
                  encrypted: autobuyConfig.encrypted_cookie,
                  iv:        autobuyConfig.iv,
                  authTag:   autobuyConfig.auth_tag,
                });

                if (plainCookie) {
                  console.log(`[shop] [auto-buy] Attempting purchase for user=${sub.user_id} handle=${restock.handle}`);
                  autobuyResult = await buyProduct(plainCookie, restock.handle, {
                    name:             autobuyConfig.name,
                    email:            autobuyConfig.email,
                    phone:            autobuyConfig.phone,
                    seven_store_id:   autobuyConfig.seven_store_id,
                    seven_store_name: autobuyConfig.seven_store_name,
                    seven_store_addr: autobuyConfig.seven_store_addr,
                  });
                  console.log(`[shop] [auto-buy] Result for ${restock.handle}:`, autobuyResult.success ? '✅ success' : `❌ ${autobuyResult.error}`);
                } else {
                  console.warn(`[shop] [auto-buy] Cookie decryption failed for user=${sub.user_id}, skipping auto-buy.`);
                  autobuyResult = { success: false, error: 'Cookie 解密失敗，請重新設定 `/shop-autobuy setup`' };
                }
              }

              allRestockMatches.push({
                restock,
                categoryUrl,
                targetId:     sub.target_id,
                targetType:   sub.target_type,
                userId:       sub.user_id,
                autobuyResult,
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
    const interval = db.getIntervalMs('shop_poll_interval_ms', ENV_INTERVALS.shop_poll_interval_ms);
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
                targetId:   sub.target_id,
                targetType: sub.target_type,
                userId:     sub.user_id,
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
    const interval = db.getIntervalMs('eslite_poll_interval_ms', ENV_INTERVALS.eslite_poll_interval_ms);
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
                targetId:    sub.target_id,
                targetType:  sub.target_type,
                userId:      sub.user_id,
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
    const interval = db.getIntervalMs('momo_poll_interval_ms', ENV_INTERVALS.momo_poll_interval_ms);
    console.log(`[momo] ⏳ 下次掃描於 ${interval / 1000}s 後。`);
    setTimeout(schedule, interval);
  }

  schedule();
}

// ─── Graceful Shutdown ────────────────────────────────────────────────────────

process.on('SIGINT',  shutdown);
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
  const endHourStr   = db.getSetting(`${scraperKey}_op_hour_end`) || defaultEnd;
  const startHour    = parseInt(startHourStr, 10);
  const endHour      = parseInt(endHourStr, 10);

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
