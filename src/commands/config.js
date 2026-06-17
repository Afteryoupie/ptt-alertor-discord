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
    label:     '誠品展覽',
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
};

/** 把毫秒格式化成易讀字串，例如 300000 → "5 分鐘" */
function formatMs(ms) {
  return `${Math.round(ms / 60000)} 分鐘`;
}


/** 取得某個 scraper 當前生效的間隔 (DB 優先，其次 env，最後 default) */
function getCurrentInterval(cfg) {
  const envFallback = parseInt(process.env[cfg.envKey] || String(cfg.defaultMs), 10);
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
            .addChoices(
              { name: 'PTT 看板', value: 'ptt' },
              { name: 'Funbox 商店', value: 'shop' },
              { name: '誠品展覽', value: 'eslite' },
              { name: 'momo購物網', value: 'momo' },
            )
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
            .addChoices(
              { name: 'PTT 看板', value: 'ptt' },
              { name: 'Funbox 商店', value: 'shop' },
              { name: '誠品展覽', value: 'eslite' },
              { name: 'momo購物網', value: 'momo' },
            )
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
            .addChoices(
              { name: 'PTT 看板', value: 'ptt' },
              { name: 'Funbox 商店', value: 'shop' },
              { name: '誠品展覽', value: 'eslite' },
              { name: 'momo購物網', value: 'momo' },
            )
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
            .addChoices(
              { name: 'PTT 看板', value: 'ptt' },
              { name: 'Funbox 商店', value: 'shop' },
              { name: '誠品展覽', value: 'eslite' },
              { name: 'momo購物網', value: 'momo' },
            )
        )
    ),

  async execute(interaction) {

    const sub = interaction.options.getSubcommand();

    // ── interval-set ─────────────────────────────────────────────────────────
    if (sub === 'interval-set') {
      const scraperKey = interaction.options.getString('scraper', true);
      const minutes    = interaction.options.getInteger('minutes', true);
      const cfg        = INTERVAL_CONFIGS[scraperKey];

      const ms = minutes * 60_000;
      db.setSetting(cfg.key, String(ms));

      console.log(`[config] [interval-set] ${cfg.key} = ${ms}ms (set by ${interaction.user.tag})`);

      return interaction.reply({
        content: [
          `✅ **已更新 ${cfg.label} 掃描間隔！**`,
          ``,
          `⏱️  新間隔：**${formatMs(ms)}**`,
          `📌 下一次 tick 結束後即生效（不需重啟 Bot）`,
        ].join('\n'),
      });
    }

    // ── interval-get ─────────────────────────────────────────────────────────
    if (sub === 'interval-get') {
      const lines = Object.entries(INTERVAL_CONFIGS).map(([, cfg]) => {
        const current  = getCurrentInterval(cfg);
        const envVal   = parseInt(process.env[cfg.envKey] || String(cfg.defaultMs), 10);
        const dbVal    = db.getSetting(cfg.key);
        const source   = dbVal ? '🗄️ DB 設定' : '📄 ENV 預設';
        return `**${cfg.label}**  →  \`${formatMs(current)}\`  (${source})`;
      });

      return interaction.reply({
        content: [
          `⚙️ **掃描器輪詢間隔設定**`,
          ``,
          ...lines,
          ``,
          `使用 \`/config interval-set\` 修改，\`/config interval-reset\` 清除 DB 設定並恢復 ENV 預設值。`,
        ].join('\n'),
        flags: [MessageFlags.Ephemeral],
      });
    }

    // ── interval-reset ───────────────────────────────────────────────────────
    if (sub === 'interval-reset') {
      const scraperKey = interaction.options.getString('scraper', true);
      const cfg        = INTERVAL_CONFIGS[scraperKey];

      // 刪除 DB 中的設定（之後讀取時會 fallback 到 env）
      db.setSetting(cfg.key, '');

      const envFallback = parseInt(process.env[cfg.envKey] || String(cfg.defaultMs), 10);
      console.log(`[config] [interval-reset] ${cfg.key} cleared by ${interaction.user.tag}, fallback = ${envFallback}ms`);

      return interaction.reply({
        content: [
          `🔄 **已重設 ${cfg.label} 掃描間隔！**`,
          ``,
          `⏱️  恢復為 ENV 預設值：**${formatMs(envFallback)}**`,
        ].join('\n'),
      });
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
