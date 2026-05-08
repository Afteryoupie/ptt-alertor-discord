# PTT-Alertor-Discord 執行企劃書 (極致效能版)

本企劃旨在 Google Cloud VM (e2-micro 或更低規格) 上運行一個高效能、低記憶體佔用的 PTT 文章通知器。

## 1. 技術棧與效能優化策略

| 組件 | 選擇 | 優化理由 |
| :--- | :--- | :--- |
| **運行環境** | Node.js | 與現有 VM 程式相容，事件驅動架構適合 I/O 密集型任務。 |
| **Discord 庫** | `discord.js` v14 | 使用 Slash Commands，減少文字指令解析的負擔。 |
| **資料庫** | `better-sqlite3` | **關鍵點**：它是 C++ 編寫的同步資料庫，比 `sqlite3` 快且不需額外的資料庫進程，極度省電。 |
| **HTML 解析** | `RegExp` / `linkedom` | **極致優化**：針對交易版 (DC_SALE, MacShop) 建議直接用正規表達式提取標題與 ID，比 DOM 解析更省 CPU。 |
| **網路請求** | `undici` | 帶入 `over18=1` Cookie，確保能進入八卦版等限制級看板。 |

## 2. 系統架構設計

### A. 爬蟲循環 (The Scraper Loop)
- **週期**：每 5 分鐘執行一次。
- **邏輯**：
    1.  從資料庫讀取所有「訂閱中的看板」。
    2.  對每個看板執行一次 HTTP GET (PTT 看板首頁)。
    3.  比對該看板的 `last_aid` (最後抓取文章 ID)。
    4.  **增量處理**：僅解析比 `last_aid` 更新的文章，進行關鍵字與作者比對。
    5.  更新資料庫中的 `last_aid`。

### B. 資料庫結構 (Database Schema)
```sql
-- 訂閱清單
CREATE TABLE subscriptions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id TEXT,        -- Discord User ID
    target_id TEXT,      -- 通知目標 ID (可能是 Channel ID 或 User ID for DM)
    target_type TEXT,    -- 'channel' 或 'dm'
    board TEXT,          -- 看板名稱
    type TEXT,           -- 'keyword' 或 'author'
    match_value TEXT,    -- 關鍵字內容 (支援 -排除詞) 或作者 ID
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX idx_subscriptions_board ON subscriptions(board);

-- 看板狀態記錄
CREATE TABLE board_state (
    board TEXT PRIMARY KEY,
    last_aid TEXT        -- 記錄最後掃描的文章代碼，避免重複抓取
);
```

## 3. Discord 指令設計 (Slash Commands)

為了保持簡潔，僅實作以下核心指令：
- `/subscribe [看板] [類型:關鍵字/作者] [值]`：新增追蹤。
- `/unsubscribe [編號]`：刪除追蹤（先用 `/list` 查看編號）。
- `/list`：列出目前該使用者在該頻道的所有追蹤清單。

## 4. 極致效能優化細節 (The "Low-Performance" Secret)

1.  **記憶體管理**：不使用大型框架，主程式維持在 40-60MB RAM 運作。
2.  **避免重複解析**：
    -   如果多個使用者訂閱同一個看板，爬蟲每 5 分鐘**只會抓取該看板一次**。
    -   在記憶體中進行廣播通知，而非針對每個使用者重複掃描 PTT。
3.  **批次通知 (Notification Batching)**：
    -   實作發送隊列，若單次掃描命中多篇文章，合併在一個 Discord Embed 中發送，避免觸發 Discord API Rate Limit。
4.  **交易版專屬優化 (RegExp)**：
    -   針對 DC_SALE, MacShop 等格式極度固定的交易版，直接使用正規表達式抓取 `[售]`、`[買]` 與價格關鍵字，不需解析完整 HTML DOM。
    -   **關鍵字邏輯**：支援 `iPhone -128G` 排除模式，提升追蹤精準度。
5.  **多通路發送 (DM/Channel)**：
    -   程式將根據指令來源判斷發送至頻道或私訊。如果是頻道指令，會儲存 `channel_id`；如果是私訊，則儲存 `user_id` 作為發送目標。
6.  **User-Agent 偽裝與 Cookie**：
    -   請求時帶入 `Cookie: over18=1`，並隨機微調 User-Agent 以防止被封鎖。
7.  **SQLite WAL 模式**：
    -   啟動 `PRAGMA journal_mode = WAL;`，大幅提升併發讀寫效能並減少硬碟 I/O。

## 5. 部署建議

1.  **Systemd 服務**：將程式包裝成 `systemd` 服務，設定 `Restart=always`，確保自動重啟且不需 PM2 等額外工具。
2.  **環境變數**：使用 `.env` 儲存 `DISCORD_TOKEN` 與 `CLIENT_ID`。
3.  **監控**：日誌僅記錄錯誤與啟動訊息，避免產生過大的 Log 檔案佔用硬碟空間。
