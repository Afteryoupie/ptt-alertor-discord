'use strict';

// ─── Eslite Keyword Search Scraper ──────────────────────────────────────────
// Tracks product restocks and new arrivals on eslite.com via keyword search.
// Uses the public Holmes Search API: https://holmes.eslite.com/v1/search
//
// Stock detection logic:
//   button_status == "add_to_shopping_cart"  → in stock / purchaseable (可立即購買)
//   button_status == "coming_soon_book" | "coming_soon_not_book" → pre-order / coming soon (即將開賣/預購)
//   button_status == "not_add_to_notice" | "can_not_buy" → out of stock (缺貨 / 無法購買)

const HOLMES_SEARCH_API = 'https://holmes.eslite.com/v1/search';
const ESLITE_PRODUCT_BASE = 'https://www.eslite.com/product';
const ESLITE_SEARCH_BASE = 'https://www.eslite.com/Search';

const USER_AGENT = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 13_4) AppleWebKit/605.1.15 Version/17.3 Safari/605.1.15';

/**
 * Parse an Eslite search URL or bare keyword string into a canonical { keyword, canonicalUrl }.
 * Supports formats like:
 *   https://www.eslite.com/Search?keyword=beyblade+x&final_price=0,...
 *   https://www.eslite.com/Search?q=beyblade+x
 *   beyblade x
 *
 * @param {string} input
 * @returns {{ keyword: string, canonicalUrl: string }}
 */
function parseEsliteSearch(input) {
  const trimmed = input.trim();
  if (!trimmed) {
    throw new Error('請輸入有效的誠品搜尋網址或關鍵字');
  }

  let keyword = null;

  if (trimmed.startsWith('http://') || trimmed.startsWith('https://')) {
    try {
      const u = new URL(trimmed);
      keyword = u.searchParams.get('keyword') || u.searchParams.get('q');
      if (keyword) {
        keyword = keyword.trim();
      }
    } catch (_) {
      throw new Error(`無效的 URL 格式: ${trimmed}`);
    }
  } else {
    // Treat as raw keyword input
    keyword = trimmed;
  }

  if (!keyword) {
    throw new Error(`無法從輸入中解析出誠品搜尋關鍵字: ${trimmed}`);
  }

  const canonicalUrl = `${ESLITE_SEARCH_BASE}?keyword=${encodeURIComponent(keyword)}`;
  return { keyword, canonicalUrl };
}

/**
 * Backward compatibility alias for parseEsliteSearch.
 */
function parseExhibitionId(input) {
  const parsed = parseEsliteSearch(input);
  return parsed.keyword;
}

/**
 * Build canonical search URL.
 * @param {string} keyword
 * @returns {string}
 */
function esliteSearchUrl(keyword) {
  return `${ESLITE_SEARCH_BASE}?keyword=${encodeURIComponent(keyword)}`;
}

/**
 * Fetch search results for a keyword via the Holmes search API.
 * @param {string} keyword
 * @param {object} [options]
 * @returns {Promise<object[]>} normalized product list
 */
async function fetchSearchProducts(keyword, options = {}) {
  const pageSize = options.pageSize || 40;
  const pageNo = options.pageNo || 1;
  const sort = options.sort || 'desc';

  const params = new URLSearchParams({
    q: keyword,
    page_size: String(pageSize),
    page_no: String(pageNo),
    final_price: '0,',
    sort,
    branch_id: '1',
    facet: 'false',
  });

  const url = `${HOLMES_SEARCH_API}?${params.toString()}`;
  const res = await fetch(url, {
    headers: {
      'User-Agent': USER_AGENT,
      'Accept': 'application/json, text/plain, */*',
      'Accept-Language': 'zh-TW,zh;q=0.9,en-US;q=0.8,en;q=0.7',
      'Referer': `${ESLITE_SEARCH_BASE}?keyword=${encodeURIComponent(keyword)}`,
    },
    signal: AbortSignal.timeout(15_000),
  });

  if (!res.ok) {
    throw new Error(`Eslite Search API fetch failed for "${keyword}": HTTP ${res.status}`);
  }

  const data = await res.json();
  const rawList = Array.isArray(data.results) ? data.results : [];

  return rawList.map(item => ({
    id: String(item.id),
    guid: String(item.id),
    name: item.name || '(未知商品)',
    price: parseInt(item.final_price || '0', 10) || 0,
    photo: item.product_photo_url || '',
    url: `${ESLITE_PRODUCT_BASE}/${item.id}`,
    buttonStatus: item.button_status || '',
    availability: item.availability || '',
    status: item.button_status || '',
    inStock: isInStock(item),
  }));
}

/**
 * Returns true if a product is currently orderable / in stock.
 * @param {object} item
 * @returns {boolean}
 */
function isInStock(item) {
  if (typeof item.inStock === 'boolean') return item.inStock;
  const status = item.button_status || item.buttonStatus || item.status || '';
  return status === 'add_to_shopping_cart' || status === 'in_stock';
}

/**
 * Returns true if a product is coming soon / pre-orderable.
 * @param {object} item
 * @returns {boolean}
 */
function isComingSoon(item) {
  if (typeof item.comingSoon === 'boolean') return item.comingSoon;
  const status = item.button_status || item.buttonStatus || item.status || '';
  return status === 'coming_soon_book' || status === 'coming_soon_not_book' || status === 'coming_soon';
}

/**
 * Build a normalized snapshot Map of products for a keyword search.
 * Keyed by id → { id, guid, name, price, photo, url, buttonStatus, status, inStock, comingSoon }
 *
 * @param {string} keyword
 * @returns {Promise<Map<string, object>>}
 */
async function snapshotEsliteSearch(keyword) {
  const products = await fetchSearchProducts(keyword);
  const snapshot = new Map();

  for (const p of products) {
    snapshot.set(p.id, {
      id: p.id,
      guid: p.id,
      name: p.name,
      price: p.price,
      photo: p.photo,
      url: p.url,
      buttonStatus: p.buttonStatus,
      status: p.status,
      inStock: p.inStock,
      comingSoon: isComingSoon(p),
    });
  }

  return snapshot;
}

/**
 * Compare two snapshots and return restock and new arrival events.
 *
 * @param {Map<string, object>} prevSnapshot
 * @param {Map<string, object>} currSnapshot
 * @returns {Array<{ id, guid, name, price, photo, url, prevStatus, currStatus, isNewProduct, eventType }>}
 */
function detectRestocks(prevSnapshot, currSnapshot) {
  const events = [];

  for (const [id, curr] of currSnapshot) {
    const prev = prevSnapshot.get(id);
    const currInStock = isInStock(curr);
    const currComingSoon = isComingSoon(curr);

    if (!prev) {
      // Newly appeared product
      if (currInStock) {
        events.push({
          ...curr,
          prevStatus: null,
          isNewProduct: true,
          eventType: 'new_product',
        });
      } else if (currComingSoon) {
        events.push({
          ...curr,
          prevStatus: null,
          isNewProduct: true,
          eventType: 'coming_soon',
        });
      }
      continue;
    }

    const prevInStock = isInStock(prev);
    const prevComingSoon = isComingSoon(prev);

    // Status transition: was out of stock, now in stock
    if (!prevInStock && currInStock) {
      const eventType = prevComingSoon ? 'on_sale' : 'restock';
      events.push({
        ...curr,
        prevStatus: prev.buttonStatus || prev.status,
        currStatus: curr.buttonStatus || curr.status,
        isNewProduct: false,
        eventType,
      });
    } else if (!prevComingSoon && currComingSoon) {
      events.push({
        ...curr,
        prevStatus: prev.buttonStatus || prev.status,
        currStatus: curr.buttonStatus || curr.status,
        isNewProduct: false,
        eventType: 'coming_soon',
      });
    }
  }

  return events;
}

/**
 * Serialize a snapshot Map to a plain JSON-safe object for DB storage.
 */
function serializeSnapshot(snapshot) {
  return Object.fromEntries(
    [...snapshot.values()].map(p => [
      p.id,
      {
        id: p.id,
        guid: p.id,
        name: p.name,
        price: p.price,
        photo: p.photo,
        url: p.url,
        buttonStatus: p.buttonStatus,
        status: p.status,
      },
    ])
  );
}

/**
 * Deserialize a plain object back into a Map<id, product>.
 */
function deserializeSnapshot(obj) {
  if (!obj || typeof obj !== 'object') return new Map();
  return new Map(
    Object.values(obj).map(p => [
      p.id,
      {
        ...p,
        inStock: isInStock(p),
        comingSoon: isComingSoon(p),
      },
    ])
  );
}

module.exports = {
  parseEsliteSearch,
  parseExhibitionId,
  parseExhibitionUrl: parseEsliteSearch,
  exhibitionUrl: esliteSearchUrl,
  esliteSearchUrl,
  fetchSearchProducts,
  snapshotEsliteSearch,
  snapshotExhibition: snapshotEsliteSearch,
  detectRestocks,
  serializeSnapshot,
  deserializeSnapshot,
};
