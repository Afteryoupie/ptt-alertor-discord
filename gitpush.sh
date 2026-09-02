#!/bin/bash
# gitpush.sh - Commit and push changes to git repository

COMMIT_MSG="${1:-fix: 加入 Cloudflare Cookie Jar 會話與 deferReply 防止 10062 與 403 阻擋}"

echo "📦 正在 Staging 修改與刪除的檔案..."
git add -A

echo "📝 正在 Commit 修改..."
git commit -m "$COMMIT_MSG"

echo "🚀 正在 Push 至 GitHub (origin/main)..."
git push origin main

echo "✅ Git Push 完成！"
