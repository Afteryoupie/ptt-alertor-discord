// Using native fetch available in Node.js v18+

// PTT base URL
const PTT_BASE = 'https://www.ptt.cc';

// Headers to mimic a real browser — rotate slightly to avoid blocking
const USER_AGENTS = [
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/124.0 Safari/537.36',
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 13_4) AppleWebKit/605.1.15 Version/17.3 Safari/605.1.15',
  'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 Chrome/123.0 Safari/537.36',
];

function randomUA() {
  return USER_AGENTS[Math.floor(Math.random() * USER_AGENTS.length)];
}

/**
 * Fetch the raw HTML of a PTT board's first page.
 * Uses Cookie: over18=1 to bypass age restriction.
 * @param {string} board
 * @returns {Promise<string>} raw HTML
 */
async function fetchBoardPage(board) {
  const url = `${PTT_BASE}/bbs/${board}/index.html`;
  const res = await fetch(url, {
    headers: {
      'User-Agent': randomUA(),
      'Cookie': 'over18=1',
      'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8,application/signed-exchange;v=b3;q=0.7',
      'Accept-Language': 'zh-TW,zh;q=0.9,en-US;q=0.8,en;q=0.7',
      'Referer': 'https://www.ptt.cc/bbs/index.html',
      'Cache-Control': 'max-age=0',
      'Sec-Ch-Ua': '"Not_A Brand";v="8", "Chromium";v="120", "Google Chrome";v="120"',
      'Sec-Ch-Ua-Mobile': '?0',
      'Sec-Ch-Ua-Platform': '"macOS"',
      'Sec-Fetch-Dest': 'document',
      'Sec-Fetch-Mode': 'navigate',
      'Sec-Fetch-Site': 'same-origin',
      'Sec-Fetch-User': '?1',
      'Upgrade-Insecure-Requests': '1',
    },
    signal: AbortSignal.timeout(15_000),
  });

  if (!res.ok) {
    throw new Error(`PTT fetch failed for board ${board}: HTTP ${res.status}`);
  }
  return res.text();
}

// ─── Article Parsing ─────────────────────────────────────────────────────────

/**
 * Parse articles from PTT board HTML.
 * Returns articles in NEW-to-OLD order (reversed so we process oldest first).
 * Each article: { aid, title, author, url }
 *
 * Optimization: uses RegExp instead of DOM parser for maximum performance.
 * PTT's HTML structure is very regular — no need for a full parser.
 */
function parseArticles(html) {
  const articles = [];

  // Exclude pinned/sticky posts located below the r-list-sep divider
  const mainHtml = html.split(/<div class="r-list-sep"/i)[0];

  // Match each article entry block
  // <div class="r-ent">...<a href="/bbs/BOARD/M.XXXXXXX.A.XXX.html">TITLE</a>...
  const entryRe = /<div class="r-ent">([\s\S]*?)<\/div>\s*<\/div>/g;
  const hrefRe = /href="(\/bbs\/[^"]+\.html)"/;
  const titleRe = /<a[^>]*>([^<]*)<\/a>/;
  const authorRe = /<div class="author">([^<]*)<\/div>/;
  const deletedRe = /\(本文已被刪除\)|<div class="title">\s*<\/div>/;
  const annRe = /^\[公告\]/; // Announcement filter

  let match;
  while ((match = entryRe.exec(mainHtml)) !== null) {
    const block = match[1];

    // Skip deleted posts
    if (deletedRe.test(block)) continue;

    const hrefMatch = hrefRe.exec(block);
    const titleMatch = titleRe.exec(block);
    const authorMatch = authorRe.exec(block);

    if (!hrefMatch || !titleMatch) continue;

    const url = hrefMatch[1];
    // Extract article ID from URL path: /bbs/BOARD/M.XXXXXXX.A.XXX.html
    // AID is the filename without .html
    const aidMatch = /\/([^/]+)\.html$/.exec(url);
    if (!aidMatch) continue;

    const title = titleMatch[1].trim();
    // Skip announcements to reduce noise
    if (annRe.test(title)) continue;

    articles.push({
      aid: aidMatch[1],
      title,
      author: authorMatch ? authorMatch[1].trim() : '',
      url: PTT_BASE + url,
    });
  }

  // PTT lists oldest at top, newest at bottom.
  // We keep this order [oldest -> newest] so the last element is the newest.
  return articles;
}

/**
 * Return only articles newer than lastAid.
 * Uses lexicographic comparison of PTT's "M.XXXXXXXXXX.A.XXX" format.
 * (The timestamp prefix ensures correct ordering.)
 */
function filterNewArticles(articles, lastAid) {
  if (!lastAid) {
    // First run: treat the last article on page as anchor, return nothing to notify
    return [];
  }
  return articles.filter(a => a.aid > lastAid);
}

/**
 * Get the newest article ID from a list.
 * Uses reduce to find the lexicographically largest AID,
 * because PTT pages may not be in strict order after deletions.
 */
function getNewestAid(articles) {
  if (!articles.length) return null;
  return articles.reduce((max, a) => (a.aid > max ? a.aid : max), articles[0].aid);
}

// ─── Keyword Matching ────────────────────────────────────────────────────────

/**
 * Match a title/content against a keyword expression.
 * Supports negative keywords with "-" prefix.
 * Example: "iPhone -128G" → must contain "iPhone" AND NOT contain "128G"
 *
 * @param {string} title  article title
 * @param {string} expr   match expression from database
 * @returns {boolean}
 */
function matchKeyword(title, expr) {
  const tokens = expr.split(/[\s\u3000]+/).filter(Boolean);
  const lowerTitle = title.toLowerCase();

  for (const token of tokens) {
    if (token.startsWith('-')) {
      const neg = token.slice(1).toLowerCase();
      if (neg && lowerTitle.includes(neg)) return false;
    } else {
      if (!lowerTitle.includes(token.toLowerCase())) return false;
    }
  }
  return true;
}

/**
 * Match an article author against an author expression.
 * Case-insensitive exact match.
 */
function matchAuthor(articleAuthor, targetAuthor) {
  return articleAuthor.toLowerCase() === targetAuthor.toLowerCase();
}

// ─── Main Crawl Entry ────────────────────────────────────────────────────────

/**
 * Crawl one board. Returns new articles since lastAid.
 * Also returns the current page's newest AID to update state.
 *
 * @param {string} board
 * @param {string|null} lastAid
 * @returns {Promise<{ newArticles: object[], currentNewestAid: string|null }>}
 */
async function crawlBoard(board, lastAid) {
  const html = await fetchBoardPage(board);
  const allArticles = parseArticles(html);
  const currentNewestAid = getNewestAid(allArticles);

  if (!lastAid) {
    // First time: anchor at current newest, no notifications
    return { newArticles: [], allArticles, currentNewestAid };
  }

  const newArticles = filterNewArticles(allArticles, lastAid);
  return { newArticles, allArticles, currentNewestAid };
}

module.exports = {
  crawlBoard,
  matchKeyword,
  matchAuthor,
  fetchBoardPage,
  parseArticles,
};
