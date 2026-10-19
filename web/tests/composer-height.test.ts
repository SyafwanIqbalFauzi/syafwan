import assert from 'node:assert/strict';
import { test } from 'node:test';
import { clampManual, composerHeight, composerMax, COMPOSER_MIN, heightAfterKey } from '../src/lib/composer-height.ts';

test('the box never gets smaller than two lines', () => {
  assert.equal(composerHeight(10, 0, 800), COMPOSER_MIN);
  assert.equal(composerHeight(Number.NaN, 0, 800), COMPOSER_MIN);
});

test('it grows with the text up to the maximum, then scrolls', () => {
  assert.equal(composerHeight(200, 0, 800), 200);
  assert.equal(composerHeight(5000, 0, 800), composerMax(800));
});

test('a hand-set height is kept while the text is shorter', () => {
  assert.equal(composerHeight(80, 300, 800), 300);
  assert.equal(composerHeight(400, 300, 800), 400);
});

test('the maximum follows the visible area (small when the keyboard is open)', () => {
  assert.ok(composerMax(300) < composerMax(800));
  assert.equal(composerHeight(900, 0, 300), composerMax(300));
  assert.equal(composerMax(10), COMPOSER_MIN);
});

test('clampManual ignores junk and clamps to the allowed range', () => {
  assert.equal(clampManual(null, 800), 0);
  assert.equal(clampManual('abc', 800), 0);
  assert.equal(clampManual(20, 800), 0);
  assert.equal(clampManual('250', 800), 250);
  assert.equal(clampManual(99999, 800), composerMax(800));
});

test('arrow keys on the handle', () => {
  assert.equal(heightAfterKey('ArrowUp', 100, 800), 124);
  assert.equal(heightAfterKey('ArrowDown', 124, 800), 100);
  assert.equal(heightAfterKey('ArrowDown', 60, 800), 0);
  assert.equal(heightAfterKey('Home', 300, 800), 0);
  assert.equal(heightAfterKey('a', 300, 800), null);
});
