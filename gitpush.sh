#!/bin/bash
# gitpush.sh - Helper script for git add, commit, and push

COMMIT_MSG="${1:-feat: 統整追蹤清單指令，新增蝦皮追蹤與 Momo TP 店中店網址支援}"

echo "📦 正在 Staging 修改過的檔案..."
git add .

echo "📝 正在 Commit 修改..."
git commit -m "$COMMIT_MSG"

echo "🚀 正在 Push 至 GitHub (origin/main)..."
git push origin main

echo "✅ Git Push 完成！"
