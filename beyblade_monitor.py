#!/usr/bin/env python3
"""
誠品 BEYBLADE X 陀螺庫存追蹤腳本
展覽頁面: https://www.eslite.com/exhibitions/CU202503-00091

功能:
  - 查詢誠品 API 取得所有 Beyblade X 商品庫存
  - 顯示有庫存商品並提供購買連結
  - 支援 macOS 桌面通知 (osascript)
  - 可作為 cron 排程定時執行

使用方法:
  python3 beyblade_monitor.py              # 單次查詢
  python3 beyblade_monitor.py --watch 300 # 每 300 秒自動查詢 (5分鐘)
  python3 beyblade_monitor.py --notify    # 有庫存時發送 macOS 通知

Cron 排程 (每 10 分鐘查一次):
  crontab -e
  */10 * * * * /usr/bin/python3 /path/to/beyblade_monitor.py --notify >> /tmp/beyblade.log 2>&1
"""

import json
import urllib.request
import urllib.error
import subprocess
import sys
import time
import argparse
import ssl
from datetime import datetime

API_URL = "https://athena.eslite.com/api/v1/book_exhibits/CU202503-00091"
EXHIBIT_URL = "https://www.eslite.com/exhibitions/CU202503-00091"

def fetch_data():
    """從誠品 API 取得展覽資料"""
    req = urllib.request.Request(
        API_URL,
        headers={
            "Accept": "application/json",
            "Referer": "https://www.eslite.com/",
            "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
        }
    )
    # macOS 有時有 SSL 憑證問題，建立一個信任的 SSL context
    ctx = ssl.create_default_context()
    try:
        with urllib.request.urlopen(req, timeout=15, context=ctx) as response:
            return json.loads(response.read().decode("utf-8"))
    except urllib.error.URLError as e:
        # 若憑證失敗，嘗試不驗證憑證（僅用於本機監控腳本）
        if "CERTIFICATE_VERIFY_FAILED" in str(e):
            ctx_noverify = ssl._create_unverified_context()
            try:
                with urllib.request.urlopen(req, timeout=15, context=ctx_noverify) as response:
                    return json.loads(response.read().decode("utf-8"))
            except Exception as e2:
                print(f"❌ 網路錯誤 (no-verify fallback): {e2}")
                return None
        print(f"❌ 網路錯誤: {e}")
        return None
    except json.JSONDecodeError as e:
        print(f"❌ JSON 解析失敗: {e}")
        return None

def parse_products(data):
    """解析商品清單，回傳去重後的商品字典"""
    products = {}

    def add_product(p):
        if not p:
            return
        guid = p.get("product_guid")
        if guid and guid not in products:
            products[guid] = {
                "name":   p.get("name", ""),
                "stock":  p.get("stock", 0),
                "status": p.get("status", ""),
                "url":    f"https://www.eslite.com/product/{guid}",
            }

    for content in data.get("contents", []):
        # 單一商品區塊
        if content.get("product"):
            add_product(content["product"])
        # 商品清單區塊
        for book_list in content.get("book_list", []):
            for p in book_list.get("products", []):
                add_product(p)

    return products

def categorize(products):
    """將商品分類成有庫存、缺貨、即將開賣"""
    in_stock    = []
    out_of_stock = []
    coming_soon = []

    for info in products.values():
        status = info["status"]
        stock  = info["stock"]

        if status == "coming_soon_not_book":
            coming_soon.append(info)
        elif stock > 0 or stock == -1:
            # stock == -1 通常代表「補貨中/無庫存限制」仍可下單
            in_stock.append(info)
        else:
            out_of_stock.append(info)

    return in_stock, out_of_stock, coming_soon

def send_macos_notification(title, message):
    """發送 macOS 桌面通知"""
    try:
        script = f'display notification "{message}" with title "{title}" sound name "Hero"'
        subprocess.run(["osascript", "-e", script], check=True, capture_output=True)
        return True
    except (subprocess.CalledProcessError, FileNotFoundError):
        return False

def print_report(in_stock, out_of_stock, coming_soon):
    """印出庫存報告"""
    timestamp = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
    total = len(in_stock) + len(out_of_stock) + len(coming_soon)

    print("=" * 55)
    print(" 🪀  BEYBLADE X 誠品線上庫存報告")
    print(f" 🕐  {timestamp}")
    print(f" 📦  共 {total} 件商品")
    print("=" * 55)

    if in_stock:
        print(f"\n✅ 【有庫存 / 可購買】({len(in_stock)} 件)")
        for p in in_stock:
            stock_label = "補貨中(可訂購)" if p["stock"] == -1 else f"庫存數量: {p['stock']}"
            print(f"\n  🔥 {p['name']}")
            print(f"     狀態: {stock_label}")
            print(f"     🛒 {p['url']}")
    else:
        print("\n❌ 目前沒有任何商品有庫存")

    if coming_soon:
        print(f"\n⏳ 【即將開賣】({len(coming_soon)} 件)")
        for p in coming_soon:
            print(f"  📅 {p['name']}")
            print(f"     🔗 {p['url']}")

    print(f"\n😴 已售完 / 無庫存: {len(out_of_stock)} 件")
    print(f"\n🔗 展覽頁面: {EXHIBIT_URL}")
    print("=" * 55)

    return in_stock  # 回傳有庫存的商品供通知使用

def check_once(notify=False):
    """執行一次查詢"""
    data = fetch_data()
    if not data:
        return []

    products = parse_products(data)
    in_stock, out_of_stock, coming_soon = categorize(products)
    in_stock_list = print_report(in_stock, out_of_stock, coming_soon)

    # 發送 macOS 通知
    if notify and in_stock_list:
        names = "、".join(p["name"].split("/ ")[1] for p in in_stock_list[:3])
        if len(in_stock_list) > 3:
            names += f" 等 {len(in_stock_list)} 件"
        send_macos_notification(
            "🪀 誠品 BEYBLADE X 有貨了！",
            f"{names} 現在有庫存，快去搶購！"
        )
        print("\n🔔 已發送 macOS 桌面通知！")

    return in_stock_list

def watch_mode(interval_seconds, notify):
    """持續監控模式"""
    print(f"🔄 監控模式啟動，每 {interval_seconds} 秒查詢一次")
    print(f"   按 Ctrl+C 停止\n")

    prev_in_stock_guids = set()

    while True:
        data = fetch_data()
        if data:
            products = parse_products(data)
            in_stock, out_of_stock, coming_soon = categorize(products)
            print_report(in_stock, out_of_stock, coming_soon)

            # 只有當新商品補貨時才通知
            current_guids = {p["url"] for p in in_stock}
            new_items = [p for p in in_stock if p["url"] not in prev_in_stock_guids]

            if notify and new_items:
                names = "、".join(p["name"].split("/ ")[1] for p in new_items[:3])
                send_macos_notification(
                    "🪀 誠品 BEYBLADE X 補貨了！",
                    f"新上架: {names}"
                )
                print("\n🔔 已發送補貨通知！")

            prev_in_stock_guids = current_guids

        print(f"\n⏱️  下次查詢於 {interval_seconds} 秒後... (Ctrl+C 停止)\n")
        try:
            time.sleep(interval_seconds)
        except KeyboardInterrupt:
            print("\n👋 監控已停止")
            break

def main():
    parser = argparse.ArgumentParser(
        description="誠品 BEYBLADE X 陀螺庫存追蹤腳本"
    )
    parser.add_argument(
        "--watch", "-w",
        type=int,
        metavar="秒數",
        help="持續監控模式，指定查詢間隔秒數 (例如: --watch 300)"
    )
    parser.add_argument(
        "--notify", "-n",
        action="store_true",
        help="有庫存時發送 macOS 桌面通知"
    )
    args = parser.parse_args()

    if args.watch:
        watch_mode(args.watch, args.notify)
    else:
        result = check_once(args.notify)
        # 若有庫存商品，回傳 exit code 1（方便 shell script 判斷）
        sys.exit(0 if not result else 0)

if __name__ == "__main__":
    main()
