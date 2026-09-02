# PTT Alertor Discord Bot

一個極度輕量、針對低資源環境（如 Google Cloud e2-micro VM）優化的 PTT 文章追蹤 + 商店補貨通知機器人。

## 🌟 特色
- **低資源佔用**：使用 RegExp 解析網頁，避開了沉重的 DOM 解析器，RAM 佔用 < 60MB。
- **持久化儲存**：使用 SQLite (WAL 模式) 確保穩定且快速的文章追蹤。
- **大小寫不分**：支援看板名稱大小寫不分比對，同時保留 PTT 原始顯示風格。
- **多對多匹配**：看板抓取一次後在記憶體中比對多組訂閱，極大化減少對 PTT 伺服器的請求次數。
- **商店補貨追蹤**：定期輪詢 Funbox 商店庫存 API，有商品補貨時即時通知。

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
SHOP_POLL_INTERVAL_MS=300000
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

### PTT 文章追蹤
- `/subscribe` - 訂閱看板關鍵字或作者。支援多關鍵字、排除詞、作者追蹤。
- `/list` - 查看目前在該頻道/私訊的所有訂閱清單。
- `/unsubscribe` - 依據編號（可從 `/list` 取得）取消訂閱。

### 🛒 Funbox 商店補貨追蹤
- `/funbox-watch add <url>` - 新增補貨追蹤。輸入 Funbox 商品分類頁面網址，當該分類有商品從缺貨變為有貨時發送通知。
- `/funbox-watch list` - 列出此頻道/私訊目前的補貨追蹤訂閱。
- `/funbox-watch remove <id>` - 依據 ID 移除補貨追蹤。

### 🏬 誠品線上展覽追蹤
- `/eslite-watch add <url>` - 新增誠品展覽追蹤。輸入誠品展覽網址，當展覽內有商品從缺貨變為有貨、或新商品上架時發送通知。
- `/eslite-watch list` - 列出此頻道/私訊目前的誠品追蹤訂閱。
- `/eslite-watch remove <id>` - 依據 ID 移除誠品展覽追蹤。

### 🛍️ momo 購物網補貨追蹤
- `/momo-watch add <url>` - 新增 momo 購物網分類追蹤。當該分類內有商品補貨或即將開賣時發送通知。
- `/momo-watch list` - 列出此頻道/私訊目前的 momo 追蹤訂閱。
- `/momo-watch remove <id>` - 依據 ID 移除 momo 追蹤。

### 🟠 蝦皮 (Shopee) 追蹤
- `/shopee-watch add <url>` - 新增蝦皮賣場/關鍵字商品追蹤（例如 `https://shopee.tw/search?keyword=戰鬥陀螺&shop=11664018`）。當賣場商品補貨、新上架或價格變動時發送通知。
- `/shopee-watch list` - 列出此頻道/私訊目前的蝦皮追蹤訂閱。
- `/shopee-watch remove <id>` - 依據 ID 移除蝦皮追蹤。

### ⚙️ 系統設定 (限伺服器管理員)
- `/config interval-set` - 設定特定掃描器（PTT/Funbox/誠品/momo）的輪詢間隔時間 (1-60 分鐘)。
- `/config interval-get` - 查看所有掃描器的輪詢間隔設定。
- `/config interval-reset` - 重設特定掃描器的輪詢間隔為環境變數預設值。
- `/config hours-set` - 設定特定掃描器的運作時間 (24小時制，設定 0-24 即可全天運作)。
- `/config hours-get` - 查看所有掃描器的運作時間設定。
- `/config hours-reset` - 重設特定掃描器的運作時間為預設值 (10:00 - 19:00)。

## 💡 進階用法與特性

### 1. PTT 關鍵字比對規則
- **多詞比對 (AND)**：多個關鍵字以「空格」或「全形空格」隔開，表示文章標題必須**同時包含**這些詞彙。
  - 範例：`iPhone 128G` (標題必須同時有這兩個詞)
- **排除詞 (NOT)**：在關鍵字前加上 `-` 號，表示文章標題**不能包含**該詞彙。
  - 範例：`iPhone -128G` (有 iPhone 但不能有 128G)
- **混合使用**：`iPhone 黑色 -128G` (要有 iPhone 和黑色，但不能有 128G)

### 2. PTT 比對特性
- **大小寫不分**：看板名稱、關鍵字、作者 ID 皆不分大小寫（例如：`macshop` = `MacShop`）。
- **作者追蹤**：採全名比對（Exact Match），輸入作者 ID 即可追蹤該作者的所有新文章。
- **自動過濾公告**：預設會自動跳過標題開頭為 `[公告]` 的文章，減少系統通知干擾。
- **自動過濾刪除文**：已刪除的文章不會觸發通知。

### 3. 通知管道
- **頻道通知**：在伺服器頻道內使用指令，通知會發送至該頻道。
- **私訊通知**：直接在機器人私訊中使用指令，通知會以私訊方式發送。

### 4. PTT 即時驗證
- 訂閱成功的瞬間，機器人會立刻檢查看板第一頁，若有符合條件的**最新一則**文章會立刻發送，方便您確認設定是否正確。

### 5. Funbox 補貨追蹤細節
- **支援的平台**：shop.funbox.com.tw（Cyberbiz 平台 JSON API）
- **URL 格式**：接受完整 URL 或路徑片段
  - 完整 URL：`https://shop.funbox.com.tw/categories/XI/KB`
  - 路徑片段：`XI/KB`
- **智慧庫存偵測**：
  - `inventory_policy: deny`（不可超賣）：從缺貨（數量 ≤ 0）變為有貨（數量 > 0）時才通知。
  - `inventory_policy: continue`（可超賣/預購）：此類商品因為永遠可訂購，**不觸發**補貨通知。
- **首次掃描**：訂閱後第一次掃描會建立庫存基準快照，之後的輪詢才會比對並通知。
- **新商品偵測**：若有全新商品出現且有實際庫存（`deny` 政策），也會觸發通知。

## 🐧 VM 部署建議 (Systemd)
專案內附 `ptt-alertor.service` 設定檔，可搭配 Systemd 實現斷電自動重啟與背景執行。
