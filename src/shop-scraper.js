'use strict';

// ─── Funbox Shop Scraper ─────────────────────────────────────────────────────
// Tracks restocking on shop.funbox.com.tw (Cyberbiz platform)
// Uses the public JSON API: /categories/<path>.json
//
// Stock detection logic (respects inventory_policy):
//   policy "deny"     — cannot oversell; qty ≤ 0 = out of stock; qty 0→positive = RESTOCK
//   policy "continue" — always orderable (qty can go negative); never a true restock event
//   New products with ALL variants using "continue" policy are also excluded.

const SHOP_BASE = 'https://shop.funbox.com.tw';

const USER_AGENTS = [
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/124.0 Safari/537.36',
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 13_4) AppleWebKit/605.1.15 Version/17.3 Safari/605.1.15',
  'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 Chrome/123.0 Safari/537.36',
];

function randomUA() {
  return USER_AGENTS[Math.floor(Math.random() * USER_AGENTS.length)];
}

/**
 * Fetch the JSON product list for a shop category path.
 * @param {string} categoryPath  e.g. "XI/KB"
 * @returns {Promise<object[]>}  array of product objects from Cyberbiz API
 */
async function fetchCategoryProducts(categoryPath) {
  const url = `${SHOP_BASE}/categories/${categoryPath}.json`;
  const res = await fetch(url, {
    headers: {
      'User-Agent': randomUA(),
      'Accept': 'application/json, text/plain, */*',
      'Accept-Language': 'zh-TW,zh;q=0.9,en-US;q=0.8,en;q=0.7',
      'Referer': `${SHOP_BASE}/categories/${categoryPath}`,
    },
    signal: AbortSignal.timeout(15_000),
  });

  if (!res.ok) {
    throw new Error(`Funbox fetch failed for category ${categoryPath}: HTTP ${res.status}`);
  }

  const data = await res.json();
  // API returns either an array or { products: [...] }
  return Array.isArray(data) ? data : (data.products || []);
}

/**
 * Build a normalized snapshot of all products in a category.
 * Returns a Map keyed by product handle → { title, url, variants }
 * Each variant has { id, sku, inventory_quantity, available }
 *
 * @param {string} categoryPath
 * @returns {Promise<Map<string, object>>}
 */
async function snapshotCategory(categoryPath) {
  const products = await fetchCategoryProducts(categoryPath);
  const snapshot = new Map();

  for (const p of products) {
    // Derive the handle from the URL field (e.g. "/products/bbpr94986" → "bbpr94986")
    const handleMatch = (p.url || '').match(/\/products\/([^/?#]+)/);
    const handle = handleMatch ? handleMatch[1] : String(p.id);

    const variants = (p.variants || []).map(v => ({
      id: v.id,
      sku: v.sku || '',
      inventory_quantity: typeof v.inventory_quantity === 'number' ? v.inventory_quantity : 0,
      // inventory_policy "deny" = cannot oversell; "continue" = can go negative
      inventory_policy: v.inventory_policy || 'deny',
    }));

    snapshot.set(handle, {
      id: p.id,
      handle,
      title: p.title || '(未知商品)',
      url: `${SHOP_BASE}/products/${handle}`,
      variants,
      // Aggregate availability: in-stock if ANY variant has qty > 0
      available: variants.some(v => v.inventory_quantity > 0),
    });
  }

  return snapshot;
}

/**
 * Returns true if a variant uses 'deny' policy (cannot oversell).
 * Only 'deny' variants can be truly "out of stock" — 'continue' variants
 * are always orderable regardless of quantity, so qty transitions on them
 * do not constitute a restock event.
 *
 * @param {object} variant
 * @returns {boolean}
 */
function isDenyPolicy(variant) {
  // Default to 'deny' if policy is absent/unknown (safe fallback)
  return !variant.inventory_policy || variant.inventory_policy === 'deny';
}

/**
 * Compare two snapshots and return restock events.
 *
 * A restock event occurs when a **deny-policy** variant transitions from
 * out-of-stock (qty ≤ 0) to in-stock (qty > 0).
 *
 * Variants with `inventory_policy === 'continue'` are excluded because they
 * are always orderable (the shop allows negative inventory / pre-orders
 * without limit), so a qty change on them is not a meaningful restock.
 *
 * @param {Map<string,object>} prevSnapshot
 * @param {Map<string,object>} currSnapshot
 * @returns {Array<{ handle, title, url, previousQty, currentQty, sku, isNewProduct }>}
 */
function detectRestocks(prevSnapshot, currSnapshot) {
  const restocks = [];

  for (const [handle, curr] of currSnapshot) {
    const prev = prevSnapshot.get(handle);

    if (!prev) {
      // New product appeared — notify only if it has at least one deny-policy
      // variant that is currently in stock. Pure continue-policy products are
      // always orderable and don't need a "new product" restock alert.
      const denyVariantsInStock = curr.variants.filter(
        v => isDenyPolicy(v) && v.inventory_quantity > 0
      );

      if (denyVariantsInStock.length > 0) {
        const qty = denyVariantsInStock.reduce((sum, v) => sum + v.inventory_quantity, 0);
        restocks.push({
          handle,
          title: curr.title,
          url: curr.url,
          previousQty: 0,
          currentQty: qty,
          sku: denyVariantsInStock.map(v => v.sku).filter(Boolean).join(', ') || handle,
          isNewProduct: true,
        });
      }
      continue;
    }

    // Check each deny-policy variant for a restock transition (qty ≤0 → >0)
    for (const currVariant of curr.variants) {
      // Skip continue-policy variants — they are always orderable
      if (!isDenyPolicy(currVariant)) continue;

      const prevVariant = prev.variants.find(v => v.id === currVariant.id);
      const prevQty = prevVariant ? prevVariant.inventory_quantity : 0;
      const currQty = currVariant.inventory_quantity;

      if (prevQty <= 0 && currQty > 0) {
        restocks.push({
          handle,
          title: curr.title,
          url: curr.url,
          previousQty: prevQty,
          currentQty: currQty,
          sku: currVariant.sku || handle,
          isNewProduct: false,
        });
      }
    }
  }

  return restocks;
}

/**
 * Serialize a snapshot to a plain JSON-safe object for DB storage.
 */
function serializeSnapshot(snapshot) {
  const obj = {};
  for (const [handle, product] of snapshot) {
    obj[handle] = {
      id: product.id,
      title: product.title,
      url: product.url,
      variants: product.variants.map(v => ({
        id: v.id,
        sku: v.sku,
        inventory_quantity: v.inventory_quantity,
        inventory_policy: v.inventory_policy,
      })),
    };
  }
  return obj;
}

/**
 * Deserialize a plain object back into a Map<handle, product>.
 */
function deserializeSnapshot(obj) {
  const snapshot = new Map();
  if (!obj || typeof obj !== 'object') return snapshot;
  for (const [handle, product] of Object.entries(obj)) {
    snapshot.set(handle, {
      id: product.id,
      handle,
      title: product.title,
      url: product.url,
      variants: product.variants || [],
      available: (product.variants || []).some(v => v.inventory_quantity > 0),
    });
  }
  return snapshot;
}

module.exports = {
  snapshotCategory,
  detectRestocks,
  serializeSnapshot,
  deserializeSnapshot,
  fetchCategoryProducts,
};
