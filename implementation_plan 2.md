# Momo 補貨追蹤整合計畫

整合 momo 購物網分類補貨追蹤至現有 ptt-alertor-discord Bot，並修復既有 bug 與調整營運時間限制。

## 設計決策確認

| 項目 | 決策 |
|------|------|
| 追蹤單位 | 分類頁（category），和 Funbox 一樣 |
| 分頁上限 | 最多抓 2 頁 |
| 追蹤範圍 | 補貨（available）＋即將開賣（coming_soon）都追蹤 |
| 營運時間 | Shop 類 scraper 改為 24 小時運作（PTT 維持 10–19）|

## Proposed Changes

---

### 1. 新增 `momo-scraper.js`

#### [NEW] [momo-scraper.js](file:///Users/linjiade/.gemini/antigravity/scratch/ptt-alertor-discord/src/momo-scraper.js)

Momo 分類追蹤邏輯。

**API 端點：**
```
POST https://www.momoshop.com.tw/api/moecapp/getCategoryGoodsV3
Body: { host: "momoshop", data: { cateCode, curPage, sortType: "6" } }
```

**支援的 URL 格式（d_code / m_code）：**
- `https://www.momoshop.com.tw/category/DgrpCategory.jsp?d_code=2701202072`
- `https://www.momoshop.com.tw/category/MgrpCategory.jsp?m_code=2701201978`

**Product status 判斷：**
```
onSaleDescription != "" → coming_soon
goodsStock != "0"       → available
else                    → out_of_stock
```

**Restock event 觸發條件：**
- `out_of_stock → available`（補貨）
- `out_of_stock → coming_soon`（新品公告）
- `coming_soon → available`（開賣）
- 新商品出現且為 available 或 coming_soon

---

### 2. 修改 `database.js`

#### [MODIFY] [database.js](file:///Users/linjiade/.gemini/antigravity/scratch/ptt-alertor-discord/src/database.js)

新增兩張表 + prepared statements + public API：

```sql
CREATE TABLE IF NOT EXISTS momo_subscriptions (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id      TEXT NOT NULL,
  target_id    TEXT NOT NULL,
  target_type  TEXT NOT NULL CHECK(target_type IN ('channel', 'dm')),
  category_url TEXT NOT NULL,
  created_at   DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS momo_snapshots (
  category_url  TEXT PRIMARY KEY,
  snapshot_json TEXT NOT NULL,
  updated_at    DATETIME DEFAULT CURRENT_TIMESTAMP
);
```

新增 `MOMO_POLL_INTERVAL_MS` 設定 key 支援。

---

### 3. 新增 `commands/momo-watch.js`

#### [NEW] [momo-watch.js](file:///Users/linjiade/.gemini/antigravity/scratch/ptt-alertor-discord/src/commands/momo-watch.js)

Slash command `/momo-watch` with subcommands: `add` / `remove` / `list`。
支援輸入完整 URL 或純 code（`2701202072`）。

---

### 4. 修改 `notifier.js`

#### [MODIFY] [notifier.js](file:///Users/linjiade/.gemini/antigravity/scratch/ptt-alertor-discord/src/notifier.js)

- 新增 `buildMomoRestockEmbed(restock, categoryUrl)` — 顯示補貨/開賣/即將開賣三種狀態
- 新增 `sendMomoRestockNotifications(client, matches)`
- 修復錯字：`💰 失費` → `💰 費用`

---

### 5. 修改 `index.js`

#### [MODIFY] [index.js](file:///Users/linjiade/.gemini/antigravity/scratch/ptt-alertor-discord/src/index.js)

- 新增 `startMomoScraperLoop()` — 結構同 `startShopScraperLoop()`
- Import `momo-scraper` + `sendMomoRestockNotifications`
- **修改 `isWithinOperatingHours()`**：只套用在 PTT scraper；Shop/Eslite/Momo 改為 24 小時
- 新增 `MOMO_POLL_INTERVAL_MS` 讀取（ENV fallback: 300000ms）
- 啟動時 log 新 interval

---

## Verification Plan

### Manual Verification
1. `node src/deploy-commands.js` — 確認新指令成功上傳
2. 在 Discord 輸入 `/momo-watch add https://www.momoshop.com.tw/category/DgrpCategory.jsp?d_code=2701202072`
3. 確認回覆訊息正確顯示分類 URL
4. Bot 重啟後確認 log 顯示 momo scraper loop 啟動
5. 確認 `notifier.js` 的錯字已修正

### 待觀察
- Momo API 是否有 rate limit / 403 問題（User-Agent 可能需要帶 cookie 或 referer）
