'use strict';

// ─── Eslite Exhibition Scraper ────────────────────────────────────────────────
// Tracks product stock on eslite.com exhibition pages.
// Uses the public JSON API: https://athena.eslite.com/api/v1/book_exhibits/<id>
//
// Stock detection logic:
//   stock > 0  — has real inventory quantity
//   stock == -1 — "continue" orderable (補貨中可訂購), treated as in-stock
//   stock == 0  — out of stock
//   status == "coming_soon_not_book" — pre-order / not yet on sale

const ESLITE_API_BASE = 'https://athena.eslite.com/api/v1/book_exhibits';
const ESLITE_PRODUCT_BASE = 'https://www.eslite.com/product';

const USER_AGENT = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 13_4) AppleWebKit/605.1.15 Version/17.3 Safari/605.1.15';

/**
 * Extract the exhibition ID from a full eslite URL or bare ID string.
 * e.g. "https://www.eslite.com/exhibitions/CU202503-00091?foo=bar" → "CU202503-00091"
 *      "CU202503-00091" → "CU202503-00091"
 * @param {string} input
 * @returns {string} exhibition ID
 */
function parseExhibitionId(input) {
  const trimmed = input.trim();
  // Try to extract from URL
  const match = trimmed.match(/eslite\.com\/exhibitions\/([^?#/]+)/i) || trimmed.match(/exhibitions\/([^?#/]+)/i);
  if (match) return match[1];

  if (trimmed.startsWith('http://') || trimmed.startsWith('https://')) {
    throw new Error(`無效的誠品展覽網址格式: ${trimmed}`);
  }

  if (/^[A-Za-z0-9_-]+$/.test(trimmed)) {
    return trimmed;
  }

  throw new Error(`無效的誠品展覽代碼格式: ${trimmed}`);
}

/**
 * Build canonical exhibition URL for display.
 * @param {string} exhibitionId
 * @returns {string}
 */
function exhibitionUrl(exhibitionId) {
  return `https://www.eslite.com/exhibitions/${exhibitionId}`;
}

/**
 * Fetch all products from an Eslite exhibition page via the public API.
 * @param {string} exhibitionId  e.g. "CU202503-00091"
 * @returns {Promise<object[]>}  flat array of product info objects
 */
async function fetchExhibitionProducts(exhibitionId) {
  const url = `${ESLITE_API_BASE}/${exhibitionId}`;
  const res = await fetch(url, {
    headers: {
      'User-Agent': USER_AGENT,
      'Accept': 'application/json, text/plain, */*',
      'Accept-Language': 'zh-TW,zh;q=0.9,en-US;q=0.8,en;q=0.7',
      'Referer': `https://www.eslite.com/exhibitions/${exhibitionId}`,
    },
    signal: AbortSignal.timeout(15_000),
  });

  if (!res.ok) {
    throw new Error(`Eslite API fetch failed for ${exhibitionId}: HTTP ${res.status}`);
  }

  const data = await res.json();
  return flattenProducts(data);
}

/**
 * Recursively flatten all products from the nested eslite API response.
 * @param {object} data
 * @returns {object[]}
 */
function flattenProducts(data) {
  const products = new Map();

  function addProduct(p) {
    if (!p || !p.product_guid) return;
    const guid = p.product_guid;
    if (!products.has(guid)) {
      products.set(guid, {
        guid,
        name: p.name || '(未知商品)',
        stock: typeof p.stock === 'number' ? p.stock : 0,
        status: p.status || '',
        url: `${ESLITE_PRODUCT_BASE}/${guid}`,
      });
    }
  }

  for (const content of (data.contents || [])) {
    // Single product embed
    if (content.product) addProduct(content.product);

    // List-of-products sections
    for (const bookList of (content.book_list || [])) {
      for (const p of (bookList.products || [])) {
        addProduct(p);
      }
    }
  }

  return [...products.values()];
}

/**
 * Build a normalized snapshot Map of all products in an exhibition.
 * Keyed by product_guid → { guid, name, url, stock, status, inStock }
 *
 * @param {string} exhibitionId
 * @returns {Promise<Map<string, object>>}
 */
async function snapshotExhibition(exhibitionId) {
  const products = await fetchExhibitionProducts(exhibitionId);
  const snapshot = new Map();

  for (const p of products) {
    snapshot.set(p.guid, {
      guid: p.guid,
      name: p.name,
      url: p.url,
      stock: p.stock,
      status: p.status,
      inStock: isInStock(p),
    });
  }

  return snapshot;
}

/**
 * Returns true if a product is considered "in stock" (orderable).
 * stock > 0  = real qty available
 * stock == -1 = can order regardless of qty (補貨中)
 * status != "coming_soon_not_book" = not yet on sale
 */
function isInStock(p) {
  if (p.status === 'coming_soon_not_book') return false;
  return p.stock > 0 || p.stock === -1;
}

/**
 * Compare two snapshots and return restock events.
 * A restock is when a product transitions from out-of-stock to in-stock.
 *
 * @param {Map<string, object>} prevSnapshot
 * @param {Map<string, object>} currSnapshot
 * @returns {Array<{ guid, name, url, prevStock, currStock, isNewProduct }>}
 */
function detectRestocks(prevSnapshot, currSnapshot) {
  const restocks = [];

  for (const [guid, curr] of currSnapshot) {
    const prev = prevSnapshot.get(guid);

    if (!prev) {
      // Newly appeared product — notify if in stock
      if (curr.inStock) {
        restocks.push({
          guid,
          name: curr.name,
          url: curr.url,
          prevStock: 0,
          currStock: curr.stock,
          status: curr.status,
          isNewProduct: true,
        });
      }
      continue;
    }

    // Restock transition: was out-of-stock, now in-stock
    if (!prev.inStock && curr.inStock) {
      restocks.push({
        guid,
        name: curr.name,
        url: curr.url,
        prevStock: prev.stock,
        currStock: curr.stock,
        status: curr.status,
        isNewProduct: false,
      });
    }
  }

  return restocks;
}

/**
 * Serialize a snapshot Map to a plain JSON-safe object for DB storage.
 */
function serializeSnapshot(snapshot) {
  return Object.fromEntries(
    [...snapshot.values()].map(p => [p.guid, { guid: p.guid, name: p.name, url: p.url, stock: p.stock, status: p.status }])
  );
}

/**
 * Deserialize a plain object back into a Map<guid, product>.
 */
function deserializeSnapshot(obj) {
  if (!obj || typeof obj !== 'object') return new Map();
  return new Map(
    Object.values(obj).map(p => [p.guid, { ...p, inStock: isInStock(p) }])
  );
}

module.exports = {
  parseExhibitionId,
  parseExhibitionUrl: parseExhibitionId,
  exhibitionUrl,
  snapshotExhibition,
  detectRestocks,
  serializeSnapshot,
  deserializeSnapshot,
  fetchExhibitionProducts,
};
