#!/bin/bash
# gitpush.sh - Commit and push changes to git repository

COMMIT_MSG="${1:-feat: 誠品改回展覽監控模式（支援售完下架404輪詢）與全爬蟲 User-Agent 防護升級}"

echo "📦 正在 Staging 修改與刪除的檔案..."
git add -A

echo "📝 正在 Commit 修改..."
git commit -m "$COMMIT_MSG"

echo "🚀 正在 Push 至 GitHub (origin/main)..."
git push origin main

echo "✅ Git Push 完成！"
