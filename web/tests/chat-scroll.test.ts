import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isNearBottom, jumpLabel, shouldAutoScroll } from '../src/lib/chat-scroll.ts';

test('isNearBottom: at the end and within slack', () => {
  assert.equal(isNearBottom({ scrollHeight: 1000, scrollTop: 600, clientHeight: 400 }), true);
  assert.equal(isNearBottom({ scrollHeight: 1000, scrollTop: 530, clientHeight: 400 }), true);
});

test('isNearBottom: reading above the end', () => {
  assert.equal(isNearBottom({ scrollHeight: 1000, scrollTop: 200, clientHeight: 400 }), false);
  assert.equal(isNearBottom({ scrollHeight: 1000, scrollTop: 519, clientHeight: 400 }), false);
});

test('shouldAutoScroll: only when following or forced', () => {
  assert.equal(shouldAutoScroll(true, false), true);
  assert.equal(shouldAutoScroll(false, false), false);
  assert.equal(shouldAutoScroll(false, true), true);
});

test('jumpLabel', () => {
  assert.equal(jumpLabel(true), 'New messages');
  assert.equal(jumpLabel(false), 'Latest');
});
