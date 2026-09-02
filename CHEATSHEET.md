# 🤖 機器人日常維護指令速查表 (Cheatsheet)

這份文件記錄了您維護 Discord 音樂機器人時最常使用的指令，您可以隨時透過 SSH 參考。

---

## 📈 1. PM2 機器人狀態管理
用於控制機器人的執行、重啟與日誌觀察。

- **查看運行狀態**
  ```bash
  pm2 list
  ```
- **查看即時日誌 (除錯必備)**
  ```bash
  pm2 logs music-bot
  ```
- **手動立即重啟**
  ```bash
  pm2 restart music-bot
  ```
- **設定「每日凌晨 4 點」定時自動重啟**
  ```bash
  pm2 restart music-bot --cron-restart="0 4 * * *"
  pm2 save
  ```
- **監控面板 (圖形化查看 CPU/記憶體)**
  ```bash
  pm2 monit
  ```
- **從零開始啟動 / 重新指定執行資料夾**
  *(當您遇到「找不到 package.json」錯誤時，可使用此方式重新建立)*
  ```bash
  pm2 delete music-bot
  cd ~/discord-music-bot  # 請替換為您實際的機器人資料夾名稱
  pm2 start npm --name "music-bot" -- start
  pm2 save
  ```

---

## ☁️ 2. Git & GitHub 同步
用於在本機與伺服器之間同步程式碼。

### 在「本機」上傳更新：
```bash
git add .
git commit -m "說明這次改了什麼"
git push
```

### 在「伺服器」抓取更新：
```bash
cd ~/discord-music-bot
git pull
pm2 restart music-bot
```

---

## 📂 3. Linux 常用檔案指令
用於在伺服器黑視窗中找尋檔案。

- **查看資料夾內容 (顯示詳細大小與時間)**
  ```bash
  ls -lh
  ```
- **查看目前所在的完整路徑**
  ```bash
  pwd
  ```
- **進入資料夾**
  ```bash
  cd src
  ```
- **回到上一層資料夾**
  ```bash
  cd ..
  ```
- **刪除檔案**
  ```bash
  rm 檔案名稱
  ```
- **刪除整個資料夾及其內容 (危險操作，請再三確認)**
  ```bash
  rm -rf 資料夾名稱
  ```

---

## 🛠️ 4. 機器人專屬功能指令
- **更新 Discord 斜線指令 (Slash Commands)**
  *(當您新增、刪除或修改指令名稱時才需要執行)*
  ```bash
  node scripts/deploy-commands.js
  ```
- **查看硬碟佔用 (如果發現空間變少)**
  ```bash
  du -sh *
  ```

---

## 💡 小撇步 (Terminal Tips)
- **自動補齊**：輸入一半的資料夾或檔案名稱時，按下 `Tab` 鍵會自動補完。
- **清除畫面**：覺得畫面太亂時，輸入 `clear` 或按下 `Ctrl + L`。
- **回顧指令**：按下鍵盤的 `向上箭頭` 可以快速尋找之前輸入過的指令。
