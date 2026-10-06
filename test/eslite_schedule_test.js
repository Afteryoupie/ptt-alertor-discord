'use strict';

const assert = require('node:assert/strict');
const { nextEsliteDelay } = require('../src/utils/eslite-schedule');
const at = time => Date.parse(`2026-10-02T${time}+08:00`);

assert.equal(nextEsliteDelay(at('10:00:00'), 60000), 10000);
assert.equal(nextEsliteDelay(at('10:30:01'), 60000), 9000);
assert.equal(nextEsliteDelay(at('10:29:00'), 60000), 10000);
assert.equal(nextEsliteDelay(at('10:59:50'), 60000), 10000);
assert.equal(nextEsliteDelay(at('10:04:59'), 60000), 1000);
assert.equal(nextEsliteDelay(at('10:05:00'), 60000), 60000);
assert.equal(nextEsliteDelay(at('10:28:50'), 300000), 10000);
assert.equal(nextEsliteDelay(at('10:00:00'), 60000, false), 60000);
assert.equal(nextEsliteDelay(at('10:00:00'), 5000), 5000);
console.log('Eslite scheduling checks passed.');
