'use strict';

const { db } = require('../connection');

const stmts = {
  getSetting: db.prepare(`
    SELECT value FROM settings WHERE key = @key
  `),

  setSetting: db.prepare(`
    INSERT INTO settings (key, value, updated_at)
    VALUES (@key, @value, CURRENT_TIMESTAMP)
    ON CONFLICT(key) DO UPDATE SET
      value      = excluded.value,
      updated_at = CURRENT_TIMESTAMP
  `),

  deleteSetting: db.prepare(`
    DELETE FROM settings WHERE key = @key
  `),

  getSettingsByPattern: db.prepare(`
    SELECT key, value FROM settings WHERE key LIKE @pattern
  `),

  getAllSettings: db.prepare(`
    SELECT key, value, updated_at FROM settings ORDER BY key
  `),
};

function getSetting(key, defaultValue) {
  const row = stmts.getSetting.get({ key });
  return row ? row.value : defaultValue;
}

function getIntervalMs(key, envFallback) {
  const val = getSetting(key);
  if (val !== undefined) {
    const parsed = parseInt(val, 10);
    if (!isNaN(parsed) && parsed > 0) return parsed;
  }
  return envFallback;
}

function setSetting(key, value) {
  stmts.setSetting.run({ key, value });
}

function getAllSettings() {
  return stmts.getAllSettings.all();
}

function getGuildSetting(guildId, key) {
  if (!guildId) return undefined;
  const row = stmts.getSetting.get({ key: `guild:${guildId}:${key}` });
  return row ? row.value : undefined;
}

function setGuildSetting(guildId, key, value) {
  if (!guildId) return;
  stmts.setSetting.run({ key: `guild:${guildId}:${key}`, value });
}

function deleteGuildSetting(guildId, key) {
  if (!guildId) return;
  stmts.deleteSetting.run({ key: `guild:${guildId}:${key}` });
}

function getGuildIntervalMs(guildId, key, envFallback) {
  const guildVal = getGuildSetting(guildId, key);
  if (guildVal !== undefined) {
    const parsed = parseInt(guildVal, 10);
    if (!isNaN(parsed) && parsed > 0) return parsed;
  }
  return getIntervalMs(key, envFallback);
}

function getMinIntervalMsAcrossGuilds(key, envFallback) {
  const globalInterval = getIntervalMs(key, envFallback);
  const pattern = `guild:%:${key}`;
  const rows = stmts.getSettingsByPattern.all({ pattern });
  let minMs = globalInterval;
  for (const row of rows) {
    const val = parseInt(row.value, 10);
    if (!isNaN(val) && val > 0) minMs = Math.min(minMs, val);
  }
  return minMs;
}

module.exports = {
  stmts,
  getSetting,
  getIntervalMs,
  setSetting,
  getAllSettings,
  getGuildSetting,
  setGuildSetting,
  deleteGuildSetting,
  getGuildIntervalMs,
  getMinIntervalMsAcrossGuilds,
};
