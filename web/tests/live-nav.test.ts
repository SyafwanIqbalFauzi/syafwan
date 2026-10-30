import assert from 'node:assert/strict';
import { test } from 'node:test';
import { focusSelector, formUrl, isPlainClick, liveTarget, sameView } from '../src/lib/live-nav.ts';

const here = 'https://syafwan.com/sejarahpersib?cat=all';

test('a link to the same page with another query is live', () => {
  assert.equal(liveTarget('/sejarahpersib?cat=research', here)?.search, '?cat=research');
  assert.equal(liveTarget('?check=1', here)?.pathname, '/sejarahpersib');
  assert.equal(liveTarget('/sejarahpersib', here)?.search, '');
});

test('another page, another site or a plain #anchor is left to the browser', () => {
  assert.equal(liveTarget('/sejarahpersib/feedback', here), null);
  assert.equal(liveTarget('https://example.com/sejarahpersib?cat=all', here), null);
  assert.equal(liveTarget('#main', here), null);
  assert.equal(liveTarget('/sejarahpersib?cat=all#top', here), null);
  assert.equal(liveTarget('http://[bad', here), null);
});

test('a GET form builds its address from the fields and drops empty ones', () => {
  const url = formUrl(null, [['q', 'persib'], ['year', ''], ['type', 'income']], 'https://syafwan.com/finance/budgets?old=1#x');
  assert.equal(url.pathname, '/finance/budgets');
  assert.equal(url.search, '?q=persib&type=income');
  assert.equal(url.hash, '');
  assert.equal(formUrl('/agent/agents', [], here).search, '');
});

test('only a plain left click is taken over', () => {
  const base = { button: 0, metaKey: false, ctrlKey: false, shiftKey: false, altKey: false, defaultPrevented: false };
  assert.equal(isPlainClick(base), true);
  assert.equal(isPlainClick({ ...base, ctrlKey: true }), false);
  assert.equal(isPlainClick({ ...base, metaKey: true }), false);
  assert.equal(isPlainClick({ ...base, button: 1 }), false);
  assert.equal(isPlainClick({ ...base, defaultPrevented: true }), false);
});

test('the #hash does not make a different view', () => {
  assert.equal(sameView('https://a.com/x?y=1#a', 'https://a.com/x?y=1'), true);
  assert.equal(sameView('https://a.com/x?y=1', 'https://a.com/x?y=2'), false);
  assert.equal(sameView('https://a.com/x', 'https://a.com/z'), false);
});

test('focus is found again by id, else by the first data attribute', () => {
  assert.equal(focusSelector('button', 'save', [['data-x', '1']]), '#save');
  assert.equal(focusSelector('BUTTON', '', [['data-check-run', '12']]), 'button[data-check-run="12"]');
  assert.equal(focusSelector('a', '', []), null);
  assert.equal(focusSelector('button', '', [['data-name', 'a"b']]), 'button[data-name="a\\"b"]');
});
