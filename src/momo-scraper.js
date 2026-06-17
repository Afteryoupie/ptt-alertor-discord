'use strict';

// ─── Momo Shop Category Scraper ───────────────────────────────────────────────
// Tracks product stock on momoshop.com.tw category pages.
// Uses the internal POST API: /api/moecapp/getCategoryGoodsV3
//
// Stock detection logic:
//   onSaleDescription == ""  AND goodsStock != "0"  → available (有貨)
//   onSaleDescription != ""                          → coming_soon (即將開賣)
//   goodsStock == "0" AND onSaleDescription == ""    → out_of_stock (缺貨)
//
// Restock events are triggered when:
//   out_of_stock   → available    (補貨)
//   out_of_stock   → coming_soon  (新品公告)
//   coming_soon    → available    (正式開賣)
//   (new product appears as available or coming_soon)

const MOMO_API_URL  = 'https://www.momoshop.com.tw/api/moecapp/getCategoryGoodsV3';
const MOMO_BASE_URL = 'https://www.momoshop.com.tw';

/** Maximum pages to fetch per category (user-configurable at construction, default 2). */
const DEFAULT_MAX_PAGES = 2;

const USER_AGENTS = [
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/124.0 Safari/537.36',
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 13_4) AppleWebKit/605.1.15 Version/17.3 Safari/605.1.15',
  'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 Chrome/123.0 Safari/537.36',
];

function randomUA() {
  return USER_AGENTS[Math.floor(Math.random() * USER_AGENTS.length)];
}

// ─── URL / Code Parsing ───────────────────────────────────────────────────────

/**
 * Parse a momo category URL or bare code into a canonical { cateCode, cateType } pair.
 *
 * Supported formats:
 *   https://www.momoshop.com.tw/category/DgrpCategory.jsp?d_code=2701202072  → { cateCode: '2701202072', cateType: 'd' }
 *   https://www.momoshop.com.tw/category/MgrpCategory.jsp?m_code=2701201978  → { cateCode: '2701201978', cateType: 'm' }
 *   2701202072  (bare, default to d_code)                                     → { cateCode: '2701202072', cateType: 'd' }
 *
 * @param {string} input
 * @returns {{ cateCode: string, cateType: 'd' | 'm' }}
 */
function parseCategoryInput(input) {
  const trimmed = input.trim();

  if (trimmed.startsWith('http')) {
    try {
      const u = new URL(trimmed);
      const dCode = u.searchParams.get('d_code');
      const mCode = u.searchParams.get('m_code');
      if (dCode) return { cateCode: dCode, cateType: 'd' };
      if (mCode) return { cateCode: mCode, cateType: 'm' };
    } catch (_) { /* fall through */ }
    throw new Error(`無法解析 momo URL: ${trimmed}`);
  }

  // Bare numeric code — default to DgrpCategory
  if (/^\d+$/.test(trimmed)) {
    return { cateCode: trimmed, cateType: 'd' };
  }

  throw new Error(`無效的 momo 分類代碼格式: ${trimmed}`);
}

/**
 * Build the canonical category URL for storage and display.
 * @param {string} cateCode
 * @param {'d'|'m'} cateType
 * @returns {string}
 */
function categoryUrl(cateCode, cateType) {
  if (cateType === 'm') {
    return `${MOMO_BASE_URL}/category/MgrpCategory.jsp?m_code=${cateCode}`;
  }
  return `${MOMO_BASE_URL}/category/DgrpCategory.jsp?d_code=${cateCode}`;
}

// ─── API Fetching ─────────────────────────────────────────────────────────────

/**
 * Fetch one page of products from a momo category via the POST API.
 *
 * @param {string} cateCode  e.g. "2701202072"
 * @param {number} page      1-indexed
 * @returns {Promise<{ goods: object[], hasMore: boolean }>}
 */
async function fetchPage(cateCode, page) {
  const body = JSON.stringify({
    host: 'momoshop',
    data: {
      cateCode,
      curPage:  String(page),
      sortType: '6',   // 6 = 上架日期
    },
  });

  const res = await fetch(MOMO_API_URL, {
    method: 'POST',
    headers: {
      'User-Agent':   randomUA(),
      'Content-Type': 'application/json',
      'Accept':       'application/json, text/plain, */*',
      'Accept-Language': 'zh-TW,zh;q=0.9,en-US;q=0.8,en;q=0.7',
      'Referer':      MOMO_BASE_URL + '/',
      'Origin':       MOMO_BASE_URL,
    },
    body,
    signal: AbortSignal.timeout(15_000),
  });

  if (!res.ok) {
    throw new Error(`Momo API failed for cateCode=${cateCode} page=${page}: HTTP ${res.status}`);
  }

  const data = await res.json();

  // Response shape: { rtnGoodsData: { goodsInfoList: [...], totalCount: N, ... } }
  const goodsInfoList = data?.rtnGoodsData?.goodsInfoList ?? [];
  const totalCount    = parseInt(data?.rtnGoodsData?.totalCount ?? '0', 10);
  const pageSize      = goodsInfoList.length;

  // Determine whether there are more pages:
  // We only know totalCount and current page's item count.
  const fetchedSoFar = (page - 1) * pageSize + pageSize;
  const hasMore = fetchedSoFar < totalCount;

  return { goods: goodsInfoList, hasMore };
}

/**
 * Fetch up to maxPages of products for a category.
 * Stops early if the API signals no more results.
 *
 * @param {string} cateCode
 * @param {number} [maxPages=DEFAULT_MAX_PAGES]
 * @returns {Promise<object[]>}  flat array of raw goods objects
 */
async function fetchAllProducts(cateCode, maxPages = DEFAULT_MAX_PAGES) {
  const allGoods = [];

  for (let page = 1; page <= maxPages; page++) {
    const { goods, hasMore } = await fetchPage(cateCode, page);
    allGoods.push(...goods);

    if (!hasMore) break;

    // Brief politeness delay between pages
    if (page < maxPages) await sleep(500);
  }

  return allGoods;
}

// ─── Snapshot Building ────────────────────────────────────────────────────────

/**
 * Determine product status from a raw momo goods object.
 * @param {object} g  raw goods item
 * @returns {'available' | 'coming_soon' | 'out_of_stock'}
 */
function getStatus(g) {
  const desc  = (g.onSaleDescription ?? '').trim();
  const stock = g.goodsStock ?? '0';

  if (desc !== '') return 'coming_soon';
  if (stock !== '0') return 'available';
  return 'out_of_stock';
}

/**
 * Build a normalized snapshot Map of all products in a momo category.
 * Keyed by goodsCode → { goodsCode, name, url, stock, onSaleDescription, status }
 *
 * @param {string} cateCode
 * @param {'d'|'m'} [cateType='d']
 * @param {number} [maxPages=DEFAULT_MAX_PAGES]
 * @returns {Promise<Map<string, object>>}
 */
async function snapshotCategory(cateCode, cateType = 'd', maxPages = DEFAULT_MAX_PAGES) {
  const rawGoods = await fetchAllProducts(cateCode, maxPages);
  const snapshot = new Map();

  for (const g of rawGoods) {
    const code = g.goodsCode ? String(g.goodsCode) : null;
    if (!code || snapshot.has(code)) continue;

    snapshot.set(code, {
      goodsCode:          code,
      name:               g.goodsName || '(未知商品)',
      url:                g.goodsUrl  ? (g.goodsUrl.startsWith('http') ? g.goodsUrl : MOMO_BASE_URL + g.goodsUrl) : `${MOMO_BASE_URL}/goods/GoodsDetail.jsp?i_code=${code}`,
      stock:              parseInt(g.goodsStock ?? '0', 10),
      onSaleDescription:  (g.onSaleDescription ?? '').trim(),
      status:             getStatus(g),
    });
  }

  return snapshot;
}

// ─── Restock Detection ────────────────────────────────────────────────────────

/**
 * Compare two snapshots and return restock/on-sale events.
 *
 * Event types:
 *   'restock'      — was out_of_stock, now available
 *   'on_sale'      — was coming_soon, now available
 *   'coming_soon'  — was out_of_stock (or new), now coming_soon
 *   'new_product'  — newly appeared and is available
 *
 * @param {Map<string, object>} prevSnapshot
 * @param {Map<string, object>} currSnapshot
 * @returns {Array<{ goodsCode, name, url, prevStatus, currStatus, onSaleDescription, eventType }>}
 */
function detectRestocks(prevSnapshot, currSnapshot) {
  const events = [];

  for (const [code, curr] of currSnapshot) {
    const prev = prevSnapshot.get(code);

    if (!prev) {
      // New product — notify if available or coming_soon
      if (curr.status === 'available') {
        events.push({ ...curr, prevStatus: null, eventType: 'new_product' });
      } else if (curr.status === 'coming_soon') {
        events.push({ ...curr, prevStatus: null, eventType: 'coming_soon' });
      }
      continue;
    }

    // Status transition events
    if (prev.status !== 'available' && curr.status === 'available') {
      // out_of_stock/coming_soon → available
      const eventType = prev.status === 'coming_soon' ? 'on_sale' : 'restock';
      events.push({ ...curr, prevStatus: prev.status, eventType });
    } else if (prev.status === 'out_of_stock' && curr.status === 'coming_soon') {
      // out_of_stock → coming_soon (new upcoming sale announced)
      events.push({ ...curr, prevStatus: prev.status, eventType: 'coming_soon' });
    }
  }

  return events;
}

// ─── Serialization ────────────────────────────────────────────────────────────

/**
 * Serialize a snapshot Map to a plain JSON-safe object for DB storage.
 * @param {Map<string, object>} snapshot
 * @returns {object}
 */
function serializeSnapshot(snapshot) {
  return Object.fromEntries(
    [...snapshot.values()].map(p => [
      p.goodsCode,
      {
        goodsCode:         p.goodsCode,
        name:              p.name,
        url:               p.url,
        stock:             p.stock,
        onSaleDescription: p.onSaleDescription,
        status:            p.status,
      },
    ])
  );
}

/**
 * Deserialize a plain object back into a Map<goodsCode, product>.
 * @param {object} obj
 * @returns {Map<string, object>}
 */
function deserializeSnapshot(obj) {
  if (!obj || typeof obj !== 'object') return new Map();
  return new Map(
    Object.values(obj).map(p => [p.goodsCode, { ...p }])
  );
}

// ─── Utilities ────────────────────────────────────────────────────────────────

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

module.exports = {
  parseCategoryInput,
  categoryUrl,
  snapshotCategory,
  detectRestocks,
  serializeSnapshot,
  deserializeSnapshot,
  fetchAllProducts,
};
