'use strict';

const { SlashCommandBuilder, MessageFlags, PermissionFlagsBits } = require('discord.js');
const db = require('../database');

// ─── 設定 key 定義 ────────────────────────────────────────────────────────────

/**
 * 所有可設定的掃描間隔
 * key      : DB key (也是 env 變數名稱的小寫版)
 * label    : 顯示名稱
 * envKey   : process.env 對應的環境變數
 * defaultMs: 預設值 (ms)
 * minMs    : 最小允許值 (ms)
 * maxMs    : 最大允許值 (ms)
 */
const INTERVAL_CONFIGS = {
  ptt: {
    key:       'poll_interval_ms',
    label:     'PTT 看板',
    envKey:    'POLL_INTERVAL_MS',
    defaultMs: 300_000,
    minMs:     60_000,    // 最短 1 分鐘
    maxMs:     3_600_000, // 最長 1 小時
  },
  thread: {
    key:       'thread_poll_interval_ms',
    label:     'PTT 置底推文',
    envKey:    'THREAD_POLL_INTERVAL_MS',
    defaultMs: 180_000,
    minMs:     60_000,
    maxMs:     3_600_000,
  },
  shop: {
    key:       'shop_poll_interval_ms',
    label:     'Funbox 商店',
    envKey:    'SHOP_POLL_INTERVAL_MS',
    defaultMs: 300_000,
    minMs:     60_000,
    maxMs:     3_600_000,
  },
  eslite: {
    key:       'eslite_poll_interval_ms',
    label:     '誠品線上',
    envKey:    'ESLITE_POLL_INTERVAL_MS',
    defaultMs: 300_000,
    minMs:     60_000,
    maxMs:     3_600_000,
  },
  momo: {
    key:       'momo_poll_interval_ms',
    label:     'momo購物網',
    envKey:    'MOMO_POLL_INTERVAL_MS',
    defaultMs: 300_000,
    minMs:     60_000,
    maxMs:     3_600_000,
  },
  shopee: {
    key:       'shopee_poll_interval_ms',
    label:     '蝦皮購物',
    envKey:    'SHOPEE_POLL_INTERVAL_MS',
    defaultMs: 300_000,
    minMs:     60_000,
    maxMs:     3_600_000,
  },
};

const SCRAPER_CHOICES = Object.entries(INTERVAL_CONFIGS).map(([value, cfg]) => ({
  name: cfg.label,
  value,
}));

/** 把毫秒格式化成易讀字串，例如 300000 → "5 分鐘" */
function formatMs(ms) {
  return `${Math.round(ms / 60000)} 分鐘`;
}


/** 取得某個 scraper 對特定 guild 當前生效的間隔 (guild 設定 > DB 全域 > env > default) */
function getCurrentInterval(guildId, cfg) {
  const envFallback = parseInt(process.env[cfg.envKey] || String(cfg.defaultMs), 10);
  if (guildId) return db.getGuildIntervalMs(guildId, cfg.key, envFallback);
  return db.getIntervalMs(cfg.key, envFallback);
}

// ─── Slash Command ────────────────────────────────────────────────────────────

module.exports = {
  data: new SlashCommandBuilder()
    .setName('config')
    .setDescription('設定 Bot 運作參數')
    .addSubcommand(sub =>
      sub
        .setName('interval-set')
        .setDescription('設定某個掃描器的輪詢間隔')
        .addStringOption(opt =>
          opt
            .setName('scraper')
            .setDescription('要設定的掃描器')
            .setRequired(true)
            .addChoices(...SCRAPER_CHOICES)
        )
        .addIntegerOption(opt =>
          opt
            .setName('minutes')
            .setDescription('輪詢間隔（分鐘），最短 1 分鐘，最長 60 分鐘')
            .setRequired(true)
            .setMinValue(1)
            .setMaxValue(60)
        )
    )
    .addSubcommand(sub =>
      sub
        .setName('interval-get')
        .setDescription('查看所有掃描器的當前輪詢間隔')
    )
    .addSubcommand(sub =>
      sub
        .setName('interval-reset')
        .setDescription('重設某個掃描器的輪詢間隔回環境變數預設值')
        .addStringOption(opt =>
          opt
            .setName('scraper')
            .setDescription('要重設的掃描器')
            .setRequired(true)
            .addChoices(...SCRAPER_CHOICES)
        )
    )
    .addSubcommand(sub =>
      sub
        .setName('hours-set')
        .setDescription('設定掃描器的運作時間（24小時制）')
        .addStringOption(opt =>
          opt
            .setName('scraper')
            .setDescription('要設定的掃描器')
            .setRequired(true)
            .addChoices(...SCRAPER_CHOICES)
        )
        .addIntegerOption(opt =>
          opt
            .setName('start')
            .setDescription('開始時間（0-23）')
            .setRequired(true)
            .setMinValue(0)
            .setMaxValue(23)
        )
        .addIntegerOption(opt =>
          opt
            .setName('end')
            .setDescription('結束時間（0-24，24表示到午夜）')
            .setRequired(true)
            .setMinValue(0)
            .setMaxValue(24)
        )
    )
    .addSubcommand(sub =>
      sub
        .setName('hours-get')
        .setDescription('查看所有掃描器的運作時間')
    )
    .addSubcommand(sub =>
      sub
        .setName('hours-reset')
        .setDescription('重設掃描器的運作時間回預設值')
        .addStringOption(opt =>
          opt
            .setName('scraper')
            .setDescription('要重設的掃描器')
            .setRequired(true)
            .addChoices(...SCRAPER_CHOICES)
        )
    ),

  async execute(interaction) {

    const sub = interaction.options.getSubcommand();

    // ── interval-set ─────────────────────────────────────────────────────────
    if (sub === 'interval-set') {
      const scraperKey = interaction.options.getString('scraper', true);
      const minutes    = interaction.options.getInteger('minutes', true);
      const cfg        = INTERVAL_CONFIGS[scraperKey];
      const guildId    = interaction.guildId;
      const ms         = minutes * 60_000;

      if (guildId) {
        db.setGuildSetting(guildId, cfg.key, String(ms));
        console.log(`[config] [interval-set] guild:${guildId}:${cfg.key} = ${ms}ms (set by ${interaction.user.tag})`);
        return interaction.reply({
          content: [
            `✅ **已更新本伺服器的 ${cfg.label} 掃描間隔！**`,
            ``,
            `⏱️  新間隔：**${formatMs(ms)}**`,
            `📌 下一次 tick 結束後即生效（不需重啟 Bot）`,
            `💡 此設定只影響本伺服器，不影響其他伺服器。`,
          ].join('\n'),
        });
      } else {
        db.setSetting(cfg.key, String(ms));
        console.log(`[config] [interval-set] global:${cfg.key} = ${ms}ms (set by ${interaction.user.tag})`);
        return interaction.reply({
          content: [
            `✅ **已更新全域 ${cfg.label} 掃描間隔！**`,
            ``,
            `⏱️  新間隔：**${formatMs(ms)}**`,
            `📌 下一次 tick 結束後即生效（不需重啟 Bot）`,
            `💡 私訊中設定會作為無自訂間隔伺服器的全域預設值。`,
          ].join('\n'),
        });
      }
    }

    // ── interval-get ─────────────────────────────────────────────────────────
    if (sub === 'interval-get') {
      const guildId = interaction.guildId || '';
      const lines = Object.entries(INTERVAL_CONFIGS).map(([, cfg]) => {
        const current  = getCurrentInterval(guildId, cfg);
        const guildVal = guildId ? db.getGuildSetting(guildId, cfg.key) : undefined;
        const globalVal = db.getSetting(cfg.key);
        const source   = guildVal  ? '🏠 本伺服器設定'
                       : globalVal ? '🌐 全域設定'
                       :             '📄 ENV 預設';
        return `**${cfg.label}**  →  \`${formatMs(current)}\`  (${source})`;
      });

      const scopeTitle = guildId ? '（本伺服器）' : '（全域 / 私訊）';
      const resetHint  = guildId ? '清除本伺服器設定並恢復全域預設值。' : '清除全域 DB 設定並恢復 ENV 預設值。';

      return interaction.reply({
        content: [
          `⚙️ **掃描器輪詢間隔設定${scopeTitle}**`,
          ``,
          ...lines,
          ``,
          `使用 \`/config interval-set\` 修改，\`/config interval-reset\` ${resetHint}`,
        ].join('\n'),
        flags: [MessageFlags.Ephemeral],
      });
    }

    // ── interval-reset ───────────────────────────────────────────────────────
    if (sub === 'interval-reset') {
      const scraperKey = interaction.options.getString('scraper', true);
      const cfg        = INTERVAL_CONFIGS[scraperKey];
      const guildId    = interaction.guildId;

      if (guildId) {
        // 刪除本伺服器的設定，fallback 到全域/env
        db.deleteGuildSetting(guildId, cfg.key);
        const envFallback = parseInt(process.env[cfg.envKey] || String(cfg.defaultMs), 10);
        const effectiveMs = db.getIntervalMs(cfg.key, envFallback);
        console.log(`[config] [interval-reset] guild:${guildId}:${cfg.key} cleared by ${interaction.user.tag}, fallback = ${effectiveMs}ms`);

        return interaction.reply({
          content: [
            `🔄 **已清除本伺服器的 ${cfg.label} 掃描間隔設定！**`,
            ``,
            `⏱️  現在使用的間隔：**${formatMs(effectiveMs)}**（全域 / ENV 預設）`,
            `💡 若要重新自訂，請使用 \`/config interval-set\`。`,
          ].join('\n'),
        });
      } else {
        // 私訊中：刪除全域 DB 設定，fallback 到 ENV 預設
        db.deleteSetting(cfg.key);
        const envFallback = parseInt(process.env[cfg.envKey] || String(cfg.defaultMs), 10);
        console.log(`[config] [interval-reset] global:${cfg.key} cleared by ${interaction.user.tag}, fallback = ${envFallback}ms`);

        return interaction.reply({
          content: [
            `🔄 **已清除全域 ${cfg.label} 掃描間隔設定！**`,
            ``,
            `⏱️  恢復為 ENV 預設值：**${formatMs(envFallback)}**`,
          ].join('\n'),
        });
      }
    }
    // ── hours-set ────────────────────────────────────────────────────────────
    if (sub === 'hours-set') {
      const scraperKey = interaction.options.getString('scraper', true);
      const startHour  = interaction.options.getInteger('start', true);
      const endHour    = interaction.options.getInteger('end', true);
      const cfg        = INTERVAL_CONFIGS[scraperKey];

      if (startHour === endHour) {
        return interaction.reply({
          content: '❌ 開始時間與結束時間不能相同。若要全天運作，請設定 0 到 24。',
          flags: [MessageFlags.Ephemeral],
        });
      }

      db.setSetting(`${scraperKey}_op_hour_start`, String(startHour));
      db.setSetting(`${scraperKey}_op_hour_end`, String(endHour));

      console.log(`[config] [hours-set] ${scraperKey} hours set to ${startHour}:00 - ${endHour}:00 by ${interaction.user.tag}`);

      return interaction.reply({
        content: [
          `✅ **已更新 ${cfg.label} 掃描運作時間！**`,
          ``,
          `⏱️  新時間：**${startHour}:00 - ${endHour}:00**`,
        ].join('\n'),
      });
    }

    // ── hours-get ────────────────────────────────────────────────────────────
    if (sub === 'hours-get') {
      const lines = Object.entries(INTERVAL_CONFIGS).map(([key, cfg]) => {
        let defaultStart = '10';
        let defaultEnd = '19';

        const startDb = db.getSetting(`${key}_op_hour_start`);
        const endDb   = db.getSetting(`${key}_op_hour_end`);
        const startHour = startDb !== undefined ? startDb : defaultStart;
        const endHour   = endDb !== undefined ? endDb : defaultEnd;
        const source    = (startDb !== undefined || endDb !== undefined) ? '🗄️ DB 設定' : '📄 預設值';

        return `**${cfg.label}**  →  \`${startHour}:00 - ${endHour}:00\`  (${source})`;
      });

      return interaction.reply({
        content: [
          `⚙️ **掃描器運作時間設定**`,
          ``,
          ...lines,
          ``,
          `使用 \`/config hours-set\` 修改，\`/config hours-reset\` 恢復預設值。`,
        ].join('\n'),
        flags: [MessageFlags.Ephemeral],
      });
    }

    // ── hours-reset ──────────────────────────────────────────────────────────
    if (sub === 'hours-reset') {
      const scraperKey = interaction.options.getString('scraper', true);
      const cfg        = INTERVAL_CONFIGS[scraperKey];

      db.setSetting(`${scraperKey}_op_hour_start`, '');
      db.setSetting(`${scraperKey}_op_hour_end`, '');

      let defaultStart = '10';
      let defaultEnd = '19';

      console.log(`[config] [hours-reset] ${scraperKey} hours cleared by ${interaction.user.tag}, fallback to default ${defaultStart}-${defaultEnd}`);

      return interaction.reply({
        content: [
          `🔄 **已重設 ${cfg.label} 掃描運作時間！**`,
          ``,
          `⏱️  恢復為預設值：**${defaultStart}:00 - ${defaultEnd}:00**`,
        ].join('\n'),
      });
    }
  },
};
