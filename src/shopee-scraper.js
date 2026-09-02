'use strict';

/**
 * Shopee (蝦皮購物) scraper module
 * Uses Shopee public shop APIs (get_shop_detail & get_categories)
 * to monitor shop item count, category inventory, and new product arrivals.
 */

/**
 * Parse a Shopee search or shop URL to extract shop ID and keyword.
 * Examples:
 *   https://shopee.tw/search?keyword=%E6%88%B0%E9%AC%A5%E9%99%80%E8%9E%BA&shop=11664018
 *   https://shopee.tw/shop/11664018/search?keyword=戰鬥陀螺
 *   https://shopee.tw/shop/11664018
 * @param {string} inputUrl
 * @returns {{ shopId: string|null, keyword: string|null, canonicalUrl: string }}
 */
function parseShopeeUrl(inputUrl) {
  const trimmed = inputUrl.trim();
  let u;
  try {
    u = new URL(trimmed.startsWith('http') ? trimmed : `https://${trimmed}`);
  } catch (err) {
    throw new Error('無效的 URL 格式');
  }

  let shopId = u.searchParams.get('shop') || u.searchParams.get('match_id');
  let keyword = u.searchParams.get('keyword');

  // Check path for /shop/:shopId format
  const shopPathMatch = u.pathname.match(/\/shop\/(\d+)/);
  if (shopPathMatch) {
    shopId = shopPathMatch[1];
  }

  if (keyword) {
    keyword = decodeURIComponent(keyword).trim();
  }

  if (!shopId && !keyword) {
    throw new Error('無法從 URL 中解析出賣場 ID (shop) 或關鍵字 (keyword)');
  }

  // Construct canonical search URL
  const searchParams = new URLSearchParams();
  if (keyword) searchParams.set('keyword', keyword);
  if (shopId) searchParams.set('shop', shopId);

  const canonicalUrl = `https://shopee.tw/search?${searchParams.toString()}`;

  return { shopId: shopId || null, keyword: keyword || null, canonicalUrl };
}

const USER_AGENTS = [
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:130.0) Gecko/20100101 Firefox/130.0',
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 14_6_1) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.6 Safari/605.1.15',
];

function randomUA() {
  return USER_AGENTS[Math.floor(Math.random() * USER_AGENTS.length)];
}

/**
 * Fetch Shopee shop detail and category list.
 * @param {string} shopId
 */
async function fetchShopInfo(shopId) {
  const headers = {
    'User-Agent': randomUA(),
    'Referer': 'https://shopee.tw/',
    'X-Shopee-Language': 'zh-Hant',
    'Accept': 'application/json, text/plain, */*',
    'Accept-Language': 'zh-TW,zh;q=0.9,en-US;q=0.8,en;q=0.7',
    'Sec-Fetch-Dest': 'empty',
    'Sec-Fetch-Mode': 'cors',
    'Sec-Fetch-Site': 'same-origin',
  };

  const detailRes = await fetch(`https://shopee.tw/api/v4/shop/get_shop_detail?shopid=${shopId}`, { headers });
  if (!detailRes.ok) {
    throw new Error(`蝦皮 API 回傳 HTTP ${detailRes.status}`);
  }
  const detailJson = await detailRes.json();
  if (detailJson.error && detailJson.error !== 0) {
    throw new Error(`蝦皮 API 錯誤: ${detailJson.error_msg || detailJson.error}`);
  }

  const shopData = detailJson.data || {};

  // Fetch categories
  let categories = [];
  try {
    const catRes = await fetch(`https://shopee.tw/api/v4/shop/get_categories?shopid=${shopId}`, { headers });
    if (catRes.ok) {
      const catJson = await catRes.json();
      if (catJson.data && Array.isArray(catJson.data.shop_categories)) {
        categories = catJson.data.shop_categories;
      }
    }
  } catch (_) {
    // Non-fatal if categories fails
  }

  return { shopData, categories };
}

/**
 * Create a snapshot object for a Shopee search/shop subscription.
 * @param {{ shopId: string|null, keyword: string|null }} params
 */
async function snapshotShopeeSearch({ shopId, keyword }) {
  if (!shopId) {
    throw new Error('目前蝦皮追蹤需包含賣場 ID (shop)。');
  }

  const { shopData, categories } = await fetchShopInfo(shopId);

  const shopName = shopData.name || `賣場 ${shopId}`;
  const itemCount = shopData.item_count || 0;
  const latestItemCtime = shopData.latest_item_ctime || 0;
  const ratingStar = shopData.rating_star || 0;
  const followerCount = shopData.follower_count || 0;

  // Match category if keyword provided
  let matchedCategory = null;
  if (keyword) {
    const kwLower = keyword.toLowerCase();
    matchedCategory = categories.find(c =>
      c.display_name && c.display_name.toLowerCase().includes(kwLower)
    ) || null;
  }

  return {
    shopId,
    shopName,
    keyword,
    itemCount,
    latestItemCtime,
    ratingStar,
    followerCount,
    matchedCategory: matchedCategory ? {
      shopCategoryId: matchedCategory.shop_category_id,
      displayName: matchedCategory.display_name,
      total: matchedCategory.total,
      image: matchedCategory.image || null,
    } : null,
    categoryCount: categories.length,
    updatedAt: Date.now(),
  };
}

/**
 * Compare old snapshot with new snapshot to detect changes.
 * @param {object|null} oldSnap
 * @param {object} newSnap
 * @returns {Array<{ type: string, title: string, description: string, url: string }>}
 */
function detectShopeeChanges(oldSnap, newSnap) {
  if (!oldSnap) return []; // Baseline snapshot, no notifications

  const changes = [];
  const shopName = newSnap.shopName || `賣場 ${newSnap.shopId}`;
  const targetUrl = `https://shopee.tw/search?keyword=${encodeURIComponent(newSnap.keyword || '')}&shop=${newSnap.shopId}`;

  // 1. Matched category item count change (restock / new items in category)
  if (oldSnap.matchedCategory && newSnap.matchedCategory) {
    const oldTotal = oldSnap.matchedCategory.total || 0;
    const newTotal = newSnap.matchedCategory.total || 0;
    if (newTotal > oldTotal) {
      changes.push({
        type: 'restock',
        title: `🛍️ 蝦皮賣場【${shopName}】分類「${newSnap.matchedCategory.displayName}」有新商品/補貨！`,
        description: `商品數量：\`${oldTotal}\` ➡️ **\`${newTotal}\`** 筆 (+${newTotal - oldTotal})`,
        url: targetUrl,
      });
    }
  } else if (!oldSnap.matchedCategory && newSnap.matchedCategory) {
    // New category matching keyword appeared!
    changes.push({
      type: 'new_category',
      title: `✨ 蝦皮賣場【${shopName}】新增與「${newSnap.keyword}」相關的分類！`,
      description: `分類名稱：**${newSnap.matchedCategory.displayName}**（共 \`${newSnap.matchedCategory.total}\` 筆商品）`,
      url: targetUrl,
    });
  }

  return changes;
}

module.exports = {
  parseShopeeUrl,
  fetchShopInfo,
  snapshotShopeeSearch,
  detectShopeeChanges,
};
