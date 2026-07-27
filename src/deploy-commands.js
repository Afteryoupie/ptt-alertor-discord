'use strict';

require('dotenv').config();
const { REST, Routes } = require('discord.js');
const path = require('path');
const fs   = require('fs');

const token    = process.env.DISCORD_TOKEN;
const clientId = process.env.CLIENT_ID;
const guildId  = process.env.GUILD_ID || process.argv[2];

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
    if (guildId) {
      console.log(`🔄 正在即時上傳 ${commands.length} 個 Slash Commands 至指定伺服器 (Guild: ${guildId})...`);
      const data = await rest.put(Routes.applicationGuildCommands(clientId, guildId), { body: commands });
      console.log(`⚡ ✅ 伺服器指令已即時生效！共 ${data.length} 個指令。`);
    }

    console.log(`🔄 正在同步上傳 ${commands.length} 個 Slash Commands (全域 Global)...`);
    const data = await rest.put(Routes.applicationCommands(clientId), { body: commands });
    console.log(`✅ 成功上傳 ${data.length} 個全域指令。`);
    console.log('⚠️ 全域指令通常需 10~60 分鐘在 Discord 用戶端中全面重新整理生效。');
    console.log('💡 提示：若希望在特定伺服器「立刻」看到新指令，可在 .env 新增 GUILD_ID=你的伺服器ID 或執行 node src/deploy-commands.js <伺服器ID>');
  } catch (err) {
    console.error('❌ 上傳失敗:', err);
    process.exit(1);
  }
})();
