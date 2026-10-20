import assert from 'node:assert/strict';
import test from 'node:test';
import { hrefForTab, parseTypeTab, showsUnder, tabCounts, TYPE_TABS } from '../src/lib/type-tabs.ts';

test('the tabs run All, Income, Spending, Savings', () => {
  assert.deepEqual(TYPE_TABS.map((t) => t.label), ['All', 'Income', 'Spending', 'Savings']);
});

test('parseTypeTab: only the known values count, everything else is All', () => {
  assert.equal(parseTypeTab('tabungan'), 'tabungan');
  assert.equal(parseTypeTab('pemasukan'), 'pemasukan');
  assert.equal(parseTypeTab('pengeluaran'), 'pengeluaran');
  for (const bad of [null, undefined, '', 'income', 'ALL ', 'tabungan,pemasukan', 5]) assert.equal(parseTypeTab(bad), 'all');
});

test('showsUnder: All shows everything, a type tab shows only its own type', () => {
  assert.equal(showsUnder('all', 'tabungan'), true);
  assert.equal(showsUnder('tabungan', 'tabungan'), true);
  assert.equal(showsUnder('tabungan', 'pemasukan'), false);
  assert.equal(showsUnder('pemasukan', 'pengeluaran'), false);
});

test('tabCounts: All is the total and each type counts itself; unknown types only count in All', () => {
  assert.deepEqual(tabCounts(['pemasukan', 'pengeluaran', 'pengeluaran', 'tabungan', 'lain']), { all: 5, pemasukan: 1, pengeluaran: 2, tabungan: 1 });
  assert.deepEqual(tabCounts([]), { all: 0, pemasukan: 0, pengeluaran: 0, tabungan: 0 });
});

test('hrefForTab: sets or drops ?type= and keeps the other parameters', () => {
  assert.equal(hrefForTab('', 'tabungan'), '?type=tabungan');
  assert.equal(hrefForTab('?year=2025', 'pemasukan'), '?year=2025&type=pemasukan');
  assert.equal(hrefForTab('?year=2025&type=tabungan', 'all'), '?year=2025');
  assert.equal(hrefForTab('?type=tabungan', 'all'), '?');
  assert.equal(hrefForTab('?type=tabungan', 'pengeluaran'), '?type=pengeluaran');
});
