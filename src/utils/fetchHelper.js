'use strict';

/**
 * Common HTTP Fetch Helper
 * Provides unified User-Agent rotation and timeout-safe fetching for scrapers.
 */

const USER_AGENTS = [
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 14_6_1) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.6 Safari/605.1.15',
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:130.0) Gecko/20100101 Firefox/130.0',
  'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36',
];

function getRandomUserAgent() {
  return USER_AGENTS[Math.floor(Math.random() * USER_AGENTS.length)];
}

/**
 * Perform a fetch with automatic User-Agent injection and timeout abort signal.
 * @param {string} url
 * @param {RequestInit} [options={}]
 * @param {number} [timeoutMs=15000]
 * @returns {Promise<Response>}
 */
async function fetchWithTimeout(url, options = {}, timeoutMs = 15000) {
  const headers = {
    'User-Agent': getRandomUserAgent(),
    ...(options.headers || {}),
  };

  const signal = options.signal || AbortSignal.timeout(timeoutMs);

  return fetch(url, {
    ...options,
    headers,
    signal,
  });
}

module.exports = {
  USER_AGENTS,
  getRandomUserAgent,
  fetchWithTimeout,
};
