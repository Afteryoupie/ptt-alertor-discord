#!/bin/bash
# gitpush.sh - Commit and push changes to git repository

COMMIT_MSG="${1:-feat: 新增全平台 /watch 統一指令、移除 auto-buy、優化蝦皮與 momo 追蹤}"

echo "📦 正在 Staging 修改與刪除的檔案..."
git add -A

echo "📝 正在 Commit 修改..."
git commit -m "$COMMIT_MSG"

echo "🚀 正在 Push 至 GitHub (origin/main)..."
git push origin main

echo "✅ Git Push 完成！"
