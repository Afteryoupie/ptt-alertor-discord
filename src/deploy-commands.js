'use strict';

require('dotenv').config();
const { REST, Routes } = require('discord.js');
const path = require('path');
const fs   = require('fs');

const token    = process.env.DISCORD_TOKEN;
const clientId = process.env.CLIENT_ID;

if (!token || !clientId) {
  console.error('❌ 請在 .env 設定 DISCORD_TOKEN 和 CLIENT_ID');
  process.exit(1);
}

const commandsDir = path.join(__dirname, 'commands');
const commands = fs
  .readdirSync(commandsDir)
  .filter(f => f.endsWith('.js'))
  .map(f => require(path.join(commandsDir, f)).data.toJSON());

const rest = new REST({ version: '10' }).setToken(token);

(async () => {
  try {
    console.log(`🔄 正在上傳 ${commands.length} 個 Slash Commands（全域）...`);
    const data = await rest.put(Routes.applicationCommands(clientId), { body: commands });
    console.log(`✅ 成功上傳 ${data.length} 個指令。`);
    console.log('⚠️  全域指令最多需要 1 小時才能生效。');
  } catch (err) {
    console.error('❌ 上傳失敗:', err);
    process.exit(1);
  }
})();
