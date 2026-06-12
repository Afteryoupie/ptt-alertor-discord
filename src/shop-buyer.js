'use strict';

// ─── Funbox Auto-Buyer ────────────────────────────────────────────────────────
//
// Automates the purchase flow on shop.funbox.com.tw (Cyberbiz platform).
// Uses the user's session cookie to simulate a logged-in browser session.
//
// Purchase flow (reverse-engineered from real checkout):
//   1. GET /products/{handle}.json  — verify variant is still in stock, pick cheapest
//   2. POST /cart/add.json          — add 1 unit to cart
//   3. GET /cart                    — extract CSRF token from HTML <meta> tag
//   4. GET /cart.json               — get cart token (used as URL param)
//   5. POST /carts/{cartToken}/     — submit checkout (7-Eleven COD + user profile)
//
// Variant selection: picks the cheapest deny-policy variant currently in stock.

const SHOP_BASE   = 'https://shop.funbox.com.tw';
const SHIPPING_FEE = 80; // 7-Eleven COD shipping fee (NT$)

// Cyberbiz payment/shippable IDs for 7-Eleven COD (從真實結帳請求觀察到)
const SEVEN_PAYMENT_ID  = 44433;
const SEVEN_SHIPPABLE_ID = 44433;

const USER_AGENTS = [
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/124.0 Safari/537.36',
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 13_4) AppleWebKit/605.1.15 Version/17.3 Safari/605.1.15',
];

function randomUA() {
  return USER_AGENTS[Math.floor(Math.random() * USER_AGENTS.length)];
}

/**
 * Build shared request headers that mimic a logged-in browser.
 * @param {string} sessionCookie
 * @param {string} [referer]
 * @param {string} [csrfToken]
 * @returns {object}
 */
function buildHeaders(sessionCookie, referer = SHOP_BASE, csrfToken = null) {
  const headers = {
    'User-Agent':       randomUA(),
    'Accept':           'application/json, text/plain, */*',
    'Accept-Language':  'zh-TW,zh;q=0.9,en-US;q=0.8',
    'Cookie':           sessionCookie,
    'Referer':          referer,
    'X-Requested-With': 'XMLHttpRequest',
  };
  if (csrfToken) {
    headers['X-CSRF-Token'] = csrfToken;
  }
  return headers;
}

/**
 * Fetch the live product JSON and return all variants.
 * @param {string} handle
 * @param {string} sessionCookie
 * @returns {Promise<object[]>}
 */
async function fetchProductVariants(handle, sessionCookie) {
  const url = `${SHOP_BASE}/products/${handle}.json`;
  const res = await fetch(url, {
    headers: buildHeaders(sessionCookie, `${SHOP_BASE}/products/${handle}`),
    signal:  AbortSignal.timeout(15_000),
  });
  if (!res.ok) throw new Error(`fetchProductVariants HTTP ${res.status} for ${handle}`);
  const data = await res.json();
  const product = data.product || data;
  return product.variants || [];
}

/**
 * Pick the best (cheapest in-stock deny-policy) variant.
 * @param {object[]} variants
 * @returns {object | null}
 */
function pickBestVariant(variants) {
  const eligible = variants.filter(
    v => (!v.inventory_policy || v.inventory_policy === 'deny') &&
         (typeof v.inventory_quantity === 'number' ? v.inventory_quantity > 0 : v.available)
  );
  if (!eligible.length) return null;
  eligible.sort((a, b) => parseFloat(a.price) - parseFloat(b.price));
  return eligible[0];
}

/**
 * Add one unit of a variant to the cart.
 * @param {number|string} variantId
 * @param {string} sessionCookie
 * @param {string} [csrfToken]
 */
async function addToCart(variantId, sessionCookie, csrfToken) {
  const url = `${SHOP_BASE}/cart/add.json`;
  const res = await fetch(url, {
    method:  'POST',
    headers: {
      ...buildHeaders(sessionCookie, `${SHOP_BASE}/`, csrfToken),
      'Content-Type': 'application/json',
    },
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
 * Fetch the cart HTML page and extract the CSRF token from <meta name="csrf-token">.
 * @param {string} sessionCookie
 * @returns {Promise<string | null>}
 */
async function fetchCsrfToken(sessionCookie) {
  const res = await fetch(`${SHOP_BASE}/cart`, {
    headers: {
      ...buildHeaders(sessionCookie, `${SHOP_BASE}/`),
      'Accept': 'text/html,application/xhtml+xml,*/*',
    },
    signal: AbortSignal.timeout(15_000),
  });
  if (!res.ok) return null;
  const html = await res.text();
  const match = html.match(/<meta[^>]+name=["']csrf-token["'][^>]+content=["']([^"']+)["']/i)
             || html.match(/<meta[^>]+content=["']([^"']+)["'][^>]+name=["']csrf-token["']/i);
  return match ? match[1] : null;
}

/**
 * Fetch the current cart JSON.
 * @param {string} sessionCookie
 * @param {string} [csrfToken]
 * @returns {Promise<object>}
 */
async function fetchCart(sessionCookie, csrfToken) {
  const res = await fetch(`${SHOP_BASE}/cart.json`, {
    headers: buildHeaders(sessionCookie, `${SHOP_BASE}/cart`, csrfToken),
    signal:  AbortSignal.timeout(15_000),
  });
  if (!res.ok) throw new Error(`fetchCart HTTP ${res.status}`);
  return res.json();
}

/**
 * Submit the checkout order via Cyberbiz's 7-Eleven COD flow.
 *
 * Endpoint: POST /carts/{cartToken}/
 * Content-Type: application/x-www-form-urlencoded
 *
 * @param {string} sessionCookie
 * @param {string} csrfToken
 * @param {string} cartToken
 * @param {object} profile  — { name, email, phone, seven_store_id, seven_store_name, seven_store_addr }
 * @param {number} itemsTotal — sum of (price × qty) for all cart items
 * @returns {Promise<{ orderId: string, orderUrl: string, raw: object }>}
 */
async function submitCheckout(sessionCookie, csrfToken, cartToken, profile, itemsTotal) {
  const totalPrice = itemsTotal + SHIPPING_FEE;
  const storeAddr  = profile.seven_store_addr || '大五股門市(新北市五股區成泰路二段81號)';

  const params = new URLSearchParams({
    'login_input[logined][email]':                           'true',
    'order[email]':                                          profile.email || '',
    'login_input[logined][mobile]':                          'true',
    'order[country_calling_code]':                           '+886',
    'order[mobile]':                                         profile.phone || '',
    'shippable[type]':                                       'Payment',
    'shippable[id]':                                         String(SEVEN_SHIPPABLE_ID),
    'order[shipping_rate]':                                  'seven_cod',
    'order[shipping_address_attributes][seven_store_id]':    profile.seven_store_id || '962380',
    'order[shipping_address_attributes][store_name]':        profile.seven_store_name || '大五股門市',
    'order[shipping_address_attributes][address1]':          storeAddr,
    'order[billing_address_attributes][address1]':           storeAddr,
    'order[payment_id]':                                     String(SEVEN_PAYMENT_ID),
    'order[billing_address_attributes][name]':               profile.name || '',
    'order[billing_address_attributes][phone]':              profile.phone || '',
    'order[shipping_address_attributes][name]':              profile.name || '',
    'order[shipping_address_attributes][phone]':             profile.phone || '',
    'order[einvoice_attributes][invoice_type]':              'default',
    'total_price_frontend':                                  String(totalPrice),
    't':                                                     String(Date.now()),
    'config[save_cvs_customer_address]':                     'false',
  });

  const url = `${SHOP_BASE}/carts/${cartToken}/`;
  const res = await fetch(url, {
    method:  'POST',
    headers: {
      ...buildHeaders(sessionCookie, `${SHOP_BASE}/cart`, csrfToken),
      'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8',
      'Accept': 'application/json, text/javascript, */*; q=0.01',
    },
    body:    params.toString(),
    signal:  AbortSignal.timeout(30_000),
  });

  const raw = await res.json().catch(() => ({}));

  if (!res.ok) {
    throw new Error(`submitCheckout HTTP ${res.status}: ${JSON.stringify(raw).slice(0, 300)}`);
  }

  const orderId  = raw.order_number || raw.name || raw.id || raw.order?.id || null;
  const orderUrl = raw.order_status_url
    || (orderId ? `${SHOP_BASE}/orders/${orderId}` : `${SHOP_BASE}/account/orders`);

  return { orderId: orderId ? String(orderId) : '（未取得）', orderUrl, raw };
}

/**
 * Full auto-buy flow: verify stock → CSRF → add to cart → checkout.
 *
 * @param {string} sessionCookie
 * @param {string} handle
 * @param {object} profile — checkout profile from DB
 * @returns {Promise<{ success, orderId?, orderUrl?, variantTitle?, price?, error? }>}
 */
async function buyProduct(sessionCookie, handle, profile = {}) {
  try {
    // Step 1: Verify variant is still in stock (live check)
    const variants = await fetchProductVariants(handle, sessionCookie);
    const variant  = pickBestVariant(variants);

    if (!variant) {
      return { success: false, error: '商品已售完（被搶先一步了 😢）' };
    }

    console.log(`[buyer] Buying handle=${handle} variant=${variant.id} price=${variant.price}`);

    // Step 2: Fetch CSRF token from cart page
    const csrfToken = await fetchCsrfToken(sessionCookie);
    if (!csrfToken) {
      console.warn('[buyer] Could not fetch CSRF token, proceeding without it.');
    }

    // Step 3: Add to cart
    await addToCart(variant.id, sessionCookie, csrfToken);

    // Step 4: Get cart state (token + item totals)
    const cart      = await fetchCart(sessionCookie, csrfToken);
    const cartToken = cart.token;
    if (!cartToken) {
      throw new Error('無法取得購物車 token，請確認 cookie 是否有效。');
    }

    // Calculate items total from cart (sum all items)
    const itemsTotal = (cart.items || []).reduce(
      (sum, item) => sum + (item.final_price || item.price || 0) * (item.quantity || 1) / 100,
      0
    ) || parseFloat(variant.price) || 0;

    // Step 5: Submit checkout
    const { orderId, orderUrl } = await submitCheckout(
      sessionCookie, csrfToken, cartToken, profile, Math.round(itemsTotal)
    );

    return {
      success:      true,
      orderId,
      orderUrl,
      variantTitle: variant.title || variant.sku || String(variant.id),
      price:        variant.price,
    };
  } catch (err) {
    console.error(`[buyer] buyProduct failed for ${handle}:`, err.message);
    return { success: false, error: err.message };
  }
}

/**
 * Validate that a session cookie is active.
 * Fetches /account and checks whether the final URL stays on /account
 * (logged in) or redirects to /users/sign_in (not logged in).
 * @param {string} sessionCookie
 * @returns {Promise<{ valid: boolean, email?: string }>}
 */
async function validateSession(sessionCookie) {
  try {
    // Follow redirects; check where we end up
    const res = await fetch(`${SHOP_BASE}/account`, {
      headers: {
        ...buildHeaders(sessionCookie, `${SHOP_BASE}/`),
        'Accept': 'text/html,*/*',
      },
      // redirect: 'follow' is the default — let Node.js follow them
      signal: AbortSignal.timeout(10_000),
    });

    const finalUrl = res.url || '';

    // Unauthenticated → redirected to sign_in page
    if (finalUrl.includes('sign_in') || finalUrl.includes('/login')) {
      return { valid: false };
    }

    // Also validate by checking CSRF token availability (only works when logged in)
    const html   = await res.text().catch(() => '');
    const match  = html.match(/["']email["']\s*[:=]\s*["']([^"'@]+@[^"']+)["']/i);
    return { valid: true, email: match?.[1] || null };
  } catch {
    return { valid: false };
  }
}


module.exports = { buyProduct, validateSession, pickBestVariant };
