import assert from 'node:assert/strict';
import { test } from 'node:test';
import { enterSends } from '../src/lib/composer-keys.ts';

const enter = { key: 'Enter', shiftKey: false };

test('desktop: Enter sends, Shift+Enter adds a line', () => {
  assert.equal(enterSends(enter, false), true);
  assert.equal(enterSends({ ...enter, shiftKey: true }, false), false);
});

test('phone (coarse pointer): Enter never sends', () => {
  assert.equal(enterSends(enter, true), false);
});

test('other keys and IME composition do not send', () => {
  assert.equal(enterSends({ key: 'a', shiftKey: false }, false), false);
  assert.equal(enterSends({ ...enter, isComposing: true }, false), false);
});
