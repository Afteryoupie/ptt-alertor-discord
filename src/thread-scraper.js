'use strict';

// PTT base URL
const PTT_BASE = 'https://www.ptt.cc';

const USER_AGENTS = [
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/124.0 Safari/537.36',
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 13_4) AppleWebKit/605.1.15 Version/17.3 Safari/605.1.15',
  'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 Chrome/123.0 Safari/537.36',
];

function randomUA() {
  return USER_AGENTS[Math.floor(Math.random() * USER_AGENTS.length)];
}

/**
 * Normalize a PTT article URL to its canonical form (strip query strings, ensure full URL).
 * @param {string} rawUrl
 * @returns {string} canonical URL
 */
function normalizeArticleUrl(rawUrl) {
  let url = rawUrl.trim();
  if (url.startsWith('/bbs/')) {
    url = PTT_BASE + url;
  }
  // Strip query string and fragment
  const u = new URL(url);
  return `${u.origin}${u.pathname}`;
}

/**
 * Fetch a PTT article page HTML.
 * @param {string} articleUrl canonical article URL
 * @returns {Promise<string>} raw HTML
 */
async function fetchArticlePage(articleUrl) {
  const res = await fetch(articleUrl, {
    headers: {
      'User-Agent': randomUA(),
      'Cookie': 'over18=1',
      'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
      'Accept-Language': 'zh-TW,zh;q=0.9,en-US;q=0.8',
      'Referer': PTT_BASE + '/bbs/',
      'Cache-Control': 'no-cache',
    },
    signal: AbortSignal.timeout(15_000),
  });

  if (!res.ok) {
    throw new Error(`PTT article fetch failed: HTTP ${res.status} for ${articleUrl}`);
  }
  return res.text();
}

/**
 * Extract the current push offset from PTT's article-polling div.
 * This is the byte offset of the last push — used as a precise state tracker.
 * Returns null if not found (e.g. no pushes yet or HTML structure changed).
 * @param {string} html
 * @returns {string|null}
 */
function extractPollOffset(html) {
  const m = /data-offset="(\d+)"/.exec(html);
  return m ? m[1] : null;
}

/**
 * Parse all push entries from PTT article HTML.
 * Returns array in document order (oldest first).
 * Each push: { tag, userid, content, ipdatetime }
 * @param {string} html
 * @returns {Array<{tag: string, userid: string, content: string, ipdatetime: string}>}
 */
function parsePushes(html) {
  const pushes = [];

  const blockRe   = /<div class="push">([\s\S]*?)<\/div>/g;
  const tagRe     = /class="[^"]*push-tag[^"]*">(.*?)<\/span>/;
  const useridRe  = /class="[^"]*push-userid[^"]*">(.*?)<\/span>/;
  const contentRe = /class="[^"]*push-content[^"]*">([\s\S]*?)<\/span>/;
  const ipRe      = /class="push-ipdatetime">(.*?)<\/span>/;

  let m;
  while ((m = blockRe.exec(html)) !== null) {
    const block = m[1];
    const tagMatch     = tagRe.exec(block);
    const useridMatch  = useridRe.exec(block);
    const contentMatch = contentRe.exec(block);
    const ipMatch      = ipRe.exec(block);

    if (!useridMatch || !contentMatch) continue;

    // Strip leading ': ' and HTML tags from push content
    const rawContent = contentMatch[1]
      .replace(/<[^>]+>/g, '')
      .replace(/^:\s*/, '')
      .trim();

    pushes.push({
      tag:        tagMatch ? tagMatch[1].trim() : '',
      userid:     useridMatch[1].trim(),
      content:    rawContent,
      ipdatetime: ipMatch ? ipMatch[1].trim() : '',
    });
  }

  return pushes;
}

/**
 * Match a push's content against a keyword expression.
 * Supports negative keywords with "-" prefix.
 * All positive keywords must match (AND logic).
 * Example: "HD660S -徵" → must contain "HD660S" AND NOT contain "徵"
 * @param {string} content
 * @param {string} expr
 * @returns {boolean}
 */
function matchPushKeyword(content, expr) {
  const tokens = expr.split(/[\s\u3000]+/).filter(Boolean);
  const lower = content.toLowerCase();

  for (const token of tokens) {
    if (token.startsWith('-')) {
      const neg = token.slice(1).toLowerCase();
      if (neg && lower.includes(neg)) return false;
    } else {
      if (!lower.includes(token.toLowerCase())) return false;
    }
  }
  return true;
}

/**
 * High-level: fetch an article and return pushes + current poll offset.
 * @param {string} articleUrl
 * @returns {Promise<{ pushes: object[], pollOffset: string|null }>}
 */
async function crawlArticle(articleUrl) {
  const html = await fetchArticlePage(articleUrl);
  const pushes = parsePushes(html);
  const pollOffset = extractPollOffset(html);
  return { pushes, pollOffset };
}

module.exports = {
  normalizeArticleUrl,
  crawlArticle,
  parsePushes,
  extractPollOffset,
  matchPushKeyword,
};
