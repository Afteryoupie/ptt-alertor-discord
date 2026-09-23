#!/usr/bin/env python3
"""
Eslite TLS Impersonation Fetcher
Uses curl_cffi with Chrome TLS ClientHello impersonation to bypass Cloudflare TLS fingerprint blocks.
"""
import sys
import json

def fetch_exhibition(exhibition_id: str):
    try:
        from curl_cffi import requests
    except ImportError:
        sys.stderr.write("curl_cffi not installed in python environment\n")
        sys.exit(127)

    url = f"https://athena.eslite.com/api/v1/book_exhibits/{exhibition_id}"
    headers = {
        "Accept": "application/json, text/plain, */*",
        "Accept-Language": "zh-TW,zh;q=0.9,en-US;q=0.8,en;q=0.7",
        "Referer": f"https://www.eslite.com/exhibitions/{exhibition_id}",
        "Origin": "https://www.eslite.com",
    }

    try:
        resp = requests.get(url, headers=headers, impersonate="chrome120", timeout=15)
        if resp.status_code == 404:
            print(json.dumps({"status": 404, "data": []}))
            sys.exit(0)
        if resp.status_code == 200:
            print(json.dumps({"status": 200, "data": resp.json()}))
            sys.exit(0)
        sys.stderr.write(f"HTTP {resp.status_code}: {resp.text[:200]}\n")
        sys.exit(2)
    except Exception as e:
        sys.stderr.write(f"Request failed: {e}\n")
        sys.exit(3)

if __name__ == "__main__":
    if len(sys.argv) < 2:
        sys.stderr.write("Usage: eslite_tls_fetcher.py <exhibition_id>\n")
        sys.exit(1)
    fetch_exhibition(sys.argv[1].strip())
