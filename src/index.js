'use strict';

require('dotenv').config();

const { Client, GatewayIntentBits, Collection, MessageFlags } = require('discord.js');
const path = require('path');
const fs   = require('fs');

const db                  = require('./database');
const { crawlBoard, matchKeyword, matchAuthor } = require('./scraper');
const { sendNotifications } = require('./notifier');

// ─── Configuration ───────────────────────────────────────────────────────────

const TOKEN          = process.env.DISCORD_TOKEN;
const POLL_INTERVAL  = parseInt(process.env.POLL_INTERVAL_MS  || '300000', 10); // 5 min
const COOLDOWN_MS    = parseInt(process.env.COOLDOWN_MS        || '5000',   10); // 5s between boards

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
  console.log(`[startup] 🕒 Poll interval: ${POLL_INTERVAL / 1000}s`);
  startScraperLoop();
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

  // Run immediately on start, then every POLL_INTERVAL
  tick();
  setInterval(tick, POLL_INTERVAL);
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

client.login(TOKEN).catch(err => {
  console.error('[startup] ❌ Login failed:', err.message);
  process.exit(1);
});
