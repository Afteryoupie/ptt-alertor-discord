#!/bin/bash
# ============================================================
# 誠品 BEYBLADE X 陀螺庫存追蹤腳本
# 展覽頁面: https://www.eslite.com/exhibitions/CU202503-00091
# ============================================================
#
# 使用方法:
#   chmod +x beyblade_stock_checker.sh
#   ./beyblade_stock_checker.sh                    # 單次查詢
#   watch -n 300 ./beyblade_stock_checker.sh       # 每 5 分鐘自動查詢
#
# 若要用 cron 每小時自動查詢並發送通知:
#   crontab -e
#   加入: 0 * * * * /path/to/beyblade_stock_checker.sh >> /path/to/beyblade.log 2>&1
# ============================================================

API_URL="https://athena.eslite.com/api/v1/book_exhibits/CU202503-00091"
TIMESTAMP=$(date '+%Y-%m-%d %H:%M:%S')

echo "========================================"
echo " BEYBLADE X 誠品庫存查詢"
echo " 查詢時間: $TIMESTAMP"
echo "========================================"
echo ""

# 抓取 API 資料
RESPONSE=$(curl -s \
  -H "Accept: application/json" \
  -H "Referer: https://www.eslite.com/" \
  -H "User-Agent: Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36" \
  "$API_URL")

if [ -z "$RESPONSE" ]; then
  echo "❌ 無法取得資料，請檢查網路連線"
  exit 1
fi

# 使用 python3 解析 JSON 並輸出庫存狀態
python3 << 'PYTHON_EOF'
import json, sys, os

response = """RESPONSE_PLACEHOLDER"""

try:
    data = json.loads(response)
except:
    print("❌ JSON 解析失敗")
    sys.exit(1)

products = {}

def add_product(p):
    if not p:
        return
    guid = p.get("product_guid")
    if guid and guid not in products:
        products[guid] = {
            "name": p.get("name", ""),
            "stock": p.get("stock", 0),
            "status": p.get("status", ""),
        }

for content in data.get("contents", []):
    if content.get("product"):
        add_product(content["product"])
    for book_list in content.get("book_list", []):
        for p in book_list.get("products", []):
            add_product(p)

in_stock = []
out_of_stock = []
coming_soon = []

for guid, info in products.items():
    stock = info["stock"]
    status = info["status"]
    name = info["name"]
    url = f"https://www.eslite.com/product/{guid}"

    if status == "coming_soon_not_book":
        coming_soon.append((name, url, stock))
    elif stock > 0 or stock == -1:
        # stock > 0 = 有庫存, stock == -1 通常代表「無限量」或「補貨中可訂購」
        in_stock.append((name, url, stock))
    else:
        out_of_stock.append((name, url, stock))

print(f"📊 共找到 {len(products)} 件商品\n")

if in_stock:
    print("✅ 【有庫存 / 可購買】")
    for name, url, stock in in_stock:
        stock_str = "補貨中(可訂購)" if stock == -1 else f"庫存: {stock}"
        print(f"  🔥 {name}")
        print(f"     {stock_str}")
        print(f"     {url}")
    print()
else:
    print("❌ 目前沒有任何商品有庫存\n")

if coming_soon:
    print("⏳ 【即將開賣】")
    for name, url, stock in coming_soon:
        print(f"  📅 {name}")
        print(f"     {url}")
    print()

print(f"😴 已售完 / 無庫存: {len(out_of_stock)} 件")
PYTHON_EOF
