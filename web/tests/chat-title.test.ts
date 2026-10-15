import assert from 'node:assert/strict';
import { test } from 'node:test';
import { MAX_TITLE, normalizeTitle, titleFromMessage } from '../src/lib/chat-title.ts';

test('normalizeTitle trims, collapses whitespace and rejects the unusable', () => {
  assert.equal(normalizeTitle('  Migrasi   keuangan \n sheet '), 'Migrasi keuangan sheet');
  assert.equal(normalizeTitle(''), null);
  assert.equal(normalizeTitle('   '), null);
  assert.equal(normalizeTitle('x'.repeat(MAX_TITLE + 1)), null);
  assert.equal(normalizeTitle('x'.repeat(MAX_TITLE))?.length, MAX_TITLE);
  assert.equal(normalizeTitle('<script>'), null);
  assert.equal(normalizeTitle('a\u0000b'), null);
  assert.equal(normalizeTitle(null), null);
  assert.equal(normalizeTitle(7), null);
});

test('titleFromMessage uses the first non-empty line, cut and cleaned', () => {
  assert.equal(titleFromMessage('hello there'), 'hello there');
  assert.equal(titleFromMessage('\n\n  first line  \nsecond'), 'first line');
  assert.equal(titleFromMessage('<b>bold</b> idea'), 'bbold/b idea');
  const long = titleFromMessage('word '.repeat(40));
  assert.ok(long.length <= 60);
  assert.ok(long.endsWith('…'));
  assert.equal(titleFromMessage('   '), 'New chat');
});
