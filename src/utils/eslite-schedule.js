'use strict';

const HALF_HOUR_MS = 30 * 60 * 1000;
const FAST_INTERVAL_MS = 10 * 1000;
const WINDOW_BEFORE_MS = 60 * 1000;
const WINDOW_AFTER_MS = 5 * 60 * 1000;

// Taipei's UTC+8 offset preserves the same half-hour boundaries as UTC.
function nextEsliteDelay(now, normalInterval, fastEnabled = true) {
  if (!fastEnabled) return normalInterval;
  const phase = now % HALF_HOUR_MS;
  const inWindow = phase < WINDOW_AFTER_MS || phase >= HALF_HOUR_MS - WINDOW_BEFORE_MS;
  const interval = inWindow ? Math.min(normalInterval, FAST_INTERVAL_MS) : normalInterval;
  const nextAlignedPoll = interval - (now % interval);
  const nextWindowStart = HALF_HOUR_MS - WINDOW_BEFORE_MS - phase;
  return inWindow ? nextAlignedPoll : Math.min(nextAlignedPoll, nextWindowStart);
}

module.exports = { nextEsliteDelay };
