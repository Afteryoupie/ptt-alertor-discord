'use strict';

// ─── Funbox Auto-Buyer ────────────────────────────────────────────────────────
//
// Automates the purchase flow on shop.funbox.com.tw (Cyberbiz platform).
// Uses the user's session cookie to simulate a logged-in browser session.
//
// Purchase flow:
//   1. GET /products/{handle}.json  — verify the variant is still in stock
//   2. POST /cart/add.json          — add 1 unit to cart
//   3. GET /cart.json               — retrieve cart token / cart state
//   4. POST /checkouts              — create a checkout (order)
//   5. Parse order number from response
//
// Variant selection: picks the cheapest deny-policy variant currently in stock.

const SHOP_BASE = 'https://shop.funbox.com.tw';

const USER_AGENTS = [
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/124.0 Safari/537.36',
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 13_4) AppleWebKit/605.1.15 Version/17.3 Safari/605.1.15',
];

function randomUA() {
  return USER_AGENTS[Math.floor(Math.random() * USER_AGENTS.length)];
}

/**
 * Build shared request headers that mimic a logged-in browser.
 * @param {string} sessionCookie — raw cookie header value (e.g. "_session_id=abc; ...")
 * @param {string} [referer]
 * @returns {object}
 */
function buildHeaders(sessionCookie, referer = SHOP_BASE) {
  return {
    'User-Agent':      randomUA(),
    'Accept':          'application/json, text/plain, */*',
    'Accept-Language': 'zh-TW,zh;q=0.9,en-US;q=0.8',
    'Content-Type':    'application/json',
    'Cookie':          sessionCookie,
    'Referer':         referer,
    'X-Requested-With': 'XMLHttpRequest',
  };
}

/**
 * Fetch the live product JSON and return all variants.
 * @param {string} handle — product handle, e.g. "bbpr94986"
 * @param {string} sessionCookie
 * @returns {Promise<object[]>} array of variant objects
 */
async function fetchProductVariants(handle, sessionCookie) {
  const url = `${SHOP_BASE}/products/${handle}.json`;
  const res = await fetch(url, {
    headers: buildHeaders(sessionCookie, `${SHOP_BASE}/products/${handle}`),
    signal:  AbortSignal.timeout(15_000),
  });

  if (!res.ok) {
    throw new Error(`fetchProductVariants HTTP ${res.status} for ${handle}`);
  }

  const data = await res.json();
  // Cyberbiz returns { product: { variants: [...] } } or { variants: [...] }
  const product = data.product || data;
  return product.variants || [];
}

/**
 * Pick the best variant to purchase:
 * - Must use inventory_policy 'deny' (truly stockable)
 * - Must have inventory_quantity > 0
 * - Select the one with the lowest price
 *
 * @param {object[]} variants
 * @returns {object | null}
 */
function pickBestVariant(variants) {
  const eligible = variants.filter(
    v => (!v.inventory_policy || v.inventory_policy === 'deny') &&
         (typeof v.inventory_quantity === 'number' ? v.inventory_quantity > 0 : v.available)
  );
  if (!eligible.length) return null;

  // Sort by price ascending; price may be string ("399") or number
  eligible.sort((a, b) => parseFloat(a.price) - parseFloat(b.price));
  return eligible[0];
}

/**
 * Add one unit of a variant to the cart.
 * @param {number|string} variantId
 * @param {string} sessionCookie
 * @returns {Promise<object>} Cyberbiz cart response
 */
async function addToCart(variantId, sessionCookie) {
  const url = `${SHOP_BASE}/cart/add.json`;
  const res = await fetch(url, {
    method:  'POST',
    headers: buildHeaders(sessionCookie, `${SHOP_BASE}/`),
    body:    JSON.stringify({ id: variantId, quantity: 1 }),
    signal:  AbortSignal.timeout(15_000),
  });

  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`addToCart HTTP ${res.status}: ${text.slice(0, 200)}`);
  }

  return res.json();
}

/**
 * Fetch the current cart to confirm items were added and get the cart token.
 * @param {string} sessionCookie
 * @returns {Promise<object>}
 */
async function fetchCart(sessionCookie) {
  const url = `${SHOP_BASE}/cart.json`;
  const res = await fetch(url, {
    headers: buildHeaders(sessionCookie, `${SHOP_BASE}/cart`),
    signal:  AbortSignal.timeout(15_000),
  });

  if (!res.ok) {
    throw new Error(`fetchCart HTTP ${res.status}`);
  }

  return res.json();
}

/**
 * Submit the checkout (create an order).
 * Cyberbiz typically accepts POST /checkouts with a cart token.
 *
 * @param {string} sessionCookie
 * @param {string} [cartToken]
 * @returns {Promise<{ orderId: string | null, orderUrl: string | null, raw: object }>}
 */
async function submitCheckout(sessionCookie, cartToken) {
  // Try the standard Cyberbiz checkout endpoint
  const url = `${SHOP_BASE}/checkouts`;
  const body = cartToken ? { cart_token: cartToken } : {};

  const res = await fetch(url, {
    method:  'POST',
    headers: buildHeaders(sessionCookie, `${SHOP_BASE}/cart`),
    body:    JSON.stringify(body),
    signal:  AbortSignal.timeout(20_000),
  });

  const raw = await res.json().catch(() => ({}));

  if (!res.ok) {
    throw new Error(`submitCheckout HTTP ${res.status}: ${JSON.stringify(raw).slice(0, 200)}`);
  }

  // Parse order number — typical Cyberbiz response fields
  const orderId  = raw.order_number || raw.name || raw.id || null;
  const orderUrl = raw.order_status_url || (orderId ? `${SHOP_BASE}/orders/${orderId}` : null);

  return { orderId: String(orderId || ''), orderUrl, raw };
}

/**
 * Full auto-buy flow: verify stock → add to cart → checkout.
 *
 * @param {string} sessionCookie — decrypted cookie header string
 * @param {string} handle        — product handle
 * @param {number|string|null} preferredVariantId — hint from restock detection; re-verified live
 * @returns {Promise<{ success: boolean, orderId?: string, orderUrl?: string, error?: string }>}
 */
async function buyProduct(sessionCookie, handle, preferredVariantId = null) {
  try {
    // Step 1: Verify variant is still in stock (live check)
    const variants = await fetchProductVariants(handle, sessionCookie);
    const variant  = pickBestVariant(variants);

    if (!variant) {
      return { success: false, error: '商品已售完（搶先一步了 😢）' };
    }

    console.log(`[buyer] Buying handle=${handle} variant=${variant.id} price=${variant.price}`);

    // Step 2: Add to cart
    await addToCart(variant.id, sessionCookie);

    // Step 3: Verify cart
    const cart = await fetchCart(sessionCookie);
    const cartToken = cart.token || null;

    // Step 4: Checkout
    const { orderId, orderUrl } = await submitCheckout(sessionCookie, cartToken);

    return {
      success:  true,
      orderId:  orderId  || '（未知）',
      orderUrl: orderUrl || `${SHOP_BASE}/products/${handle}`,
      variantTitle: variant.title || variant.sku || String(variant.id),
      price: variant.price,
    };
  } catch (err) {
    console.error(`[buyer] buyProduct failed for ${handle}:`, err.message);
    return { success: false, error: err.message };
  }
}

/**
 * Validate that a session cookie is currently active by hitting a
 * logged-in-only endpoint and checking the response.
 *
 * @param {string} sessionCookie
 * @returns {Promise<{ valid: boolean, email?: string }>}
 */
async function validateSession(sessionCookie) {
  try {
    const url = `${SHOP_BASE}/account.json`;
    const res = await fetch(url, {
      headers: buildHeaders(sessionCookie, `${SHOP_BASE}/account`),
      signal:  AbortSignal.timeout(10_000),
    });

    if (!res.ok) {
      return { valid: false };
    }

    const data = await res.json().catch(() => ({}));
    const email = data.email || data.customer?.email || null;
    return { valid: true, email };
  } catch {
    return { valid: false };
  }
}

module.exports = { buyProduct, validateSession, pickBestVariant };
