# PTT Alertor Discord Bot

一個極度輕量、針對低資源環境（如 Google Cloud e2-micro VM）優化的 PTT 文章追蹤機器人。

## 🌟 特色
- **低資源佔用**：使用 RegExp 解析網頁，避開了沉重的 DOM 解析器，RAM 佔用 < 60MB。
- **持久化儲存**：使用 SQLite (WAL 模式) 確保穩定且快速的文章追蹤。
- **大小寫不分**：支援看板名稱大小寫不分比對，同時保留 PTT 原始顯示風格。
- **多對多匹配**：看板抓取一次後在記憶體中比對多組訂閱，極大化減少對 PTT 伺服器的請求次數。

## 🛠️ 快速開始

### 1. 安裝
```bash
npm install
```

### 2. 設定環境變數
建立 `.env` 檔案並填入以下資訊：
```env
DISCORD_TOKEN=你的機器人Token
CLIENT_ID=你的應用程式ID
POLL_INTERVAL_MS=300000
COOLDOWN_MS=5000
```

### 3. 註冊 Slash Commands
```bash
npm run deploy-commands
```

### 4. 啟動
```bash
npm start
```

## 📜 指令說明
- `/subscribe` - 訂閱看板關鍵字或作者
- `/list` - 查看目前所有的訂閱清單
- `/unsubscribe` - 依據編號取消訂閱

## 🐧 VM 部署建議 (Systemd)
專案內附 `ptt-alertor.service` 設定檔，可搭配 Systemd 實現斷電自動重啟與背景執行。
