import { test } from 'node:test';
import assert from 'node:assert/strict';
import { allItems, areaOf, pageFor, rememberPage, searchItems } from '../src/lib/nav.ts';

const memory = () => {
  const data = new Map<string, string>();
  return { getItem: (k: string) => data.get(k) ?? null, setItem: (k: string, v: string) => void data.set(k, v) };
};

test('allItems covers all areas', () => {
  const items = allItems();
  assert.equal(items.filter((i) => i.area === 'agent').length, 6);
  assert.equal(items.filter((i) => i.area === 'finance').length, 4);
  assert.equal(items.filter((i) => i.area === 'accounts').length, 1);
  assert.equal(items.filter((i) => i.area === 'persib').length, 1);
  assert.equal(new Set(items.map((i) => i.href)).size, items.length);
});

test('areaOf', () => {
  assert.equal(areaOf('/agent'), 'agent');
  assert.equal(areaOf('/agent/chat'), 'agent');
  assert.equal(areaOf('/finance/budgets'), 'finance');
  assert.equal(areaOf('/accounts'), 'accounts');
  assert.equal(areaOf('/accountsx'), null);
  assert.equal(areaOf('/sejarahpersib'), 'persib');
  assert.equal(areaOf('/sejarahpersib/x'), 'persib');
  assert.equal(areaOf('/sejarahpersibx'), null);
  assert.equal(areaOf('/financex'), null);
  assert.equal(areaOf('/en'), null);
});

test('searchItems ranks label matches first and finds by area or group', () => {
  const items = allItems();
  assert.equal(searchItems(items, '').length, items.length);
  assert.equal(searchItems(items, 'bud')[0].href, '/finance/budgets');
  assert.equal(searchItems(items, 'TRANS')[0].href, '/finance/transactions');
  assert.equal(searchItems(items, 'zzz').length, 0);
  // "finance" matches the area (and the Dashboard, whose section is 'finance') - all four pages come back
  assert.equal(searchItems(items, 'finance').length, 4);
  // 'sess' starts a label; 'history' only matches via the group
  assert.equal(searchItems(items, 'sess')[0].href, '/agent/sessions');
  assert.deepEqual(searchItems(items, 'history').map((i) => i.href), ['/agent/sessions', '/agent/usage']);
});

test('last page per area is remembered and validated', () => {
  const store = memory();
  assert.equal(pageFor(store, 'finance'), '/finance');
  rememberPage(store, '/finance/budgets');
  rememberPage(store, '/agent/skills');
  assert.equal(pageFor(store, 'finance'), '/finance/budgets');
  assert.equal(pageFor(store, 'agent'), '/agent/skills');
  rememberPage(store, '/agent/skills/some-skill'); // detail pages are not stored
  rememberPage(store, '/agent/login');
  assert.equal(pageFor(store, 'agent'), '/agent/skills');
  store.setItem('nav.lastPage', JSON.stringify({ agent: 'https://evil.example/', finance: '/finance/nope' }));
  assert.equal(pageFor(store, 'agent'), '/agent');
  assert.equal(pageFor(store, 'finance'), '/finance');
  store.setItem('nav.lastPage', 'not json');
  assert.equal(pageFor(store, 'agent'), '/agent');
});
