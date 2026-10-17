import assert from 'node:assert/strict';
import { test } from 'node:test';
import { isUnused, moveId, nextSort, normalizeCategoryName, parseCategoryFields, parseKeywords, parseOrder, sortValues } from '../src/lib/category-input.ts';

test('normalizeCategoryName: trims, collapses spaces, refuses empty / long / markup', () => {
  assert.equal(normalizeCategoryName('  Makan   &  Minum '), 'Makan & Minum');
  for (const bad of ['', '   ', 'a'.repeat(61), '<b>x</b>', 'x\u0000y', 'a\nb', null, undefined, 5, {}]) {
    assert.equal(normalizeCategoryName(bad), bad === 'a\nb' ? 'a b' : null, String(bad));
  }
  assert.equal(normalizeCategoryName('a'.repeat(60)), 'a'.repeat(60));
});

test('parseKeywords: comma text or array, trimmed, no blanks, no repeats', () => {
  assert.deepEqual(parseKeywords('kopi, nasi ,, KOPI,  warung '), ['kopi', 'nasi', 'warung']);
  assert.deepEqual(parseKeywords(['a', ' b ']), ['a', 'b']);
  assert.deepEqual(parseKeywords(''), []);
  assert.deepEqual(parseKeywords(undefined), []);
  assert.equal(parseKeywords('a'.repeat(41)), null);
  assert.equal(parseKeywords('<x>'), null);
  assert.equal(parseKeywords(Array.from({ length: 31 }, (_, i) => `k${i}`)), null);
  assert.equal(parseKeywords([1]), null);
  assert.equal(parseKeywords(5), null);
});

test('parseCategoryFields: needs a name and a type; active defaults to true', () => {
  assert.deepEqual(parseCategoryFields({ nama: ' Kopi ', jenis: 'pengeluaran' }), { ok: true, value: { nama: 'Kopi', jenis: 'pengeluaran', aktif: true, kata_kunci: [] } });
  const off = parseCategoryFields({ nama: 'Gaji', jenis: 'pemasukan', aktif: false, kata_kunci: 'gaji, bonus' });
  assert.deepEqual(off, { ok: true, value: { nama: 'Gaji', jenis: 'pemasukan', aktif: false, kata_kunci: ['gaji', 'bonus'] } });
  assert.equal(parseCategoryFields({ nama: '', jenis: 'pengeluaran' }).ok, false);
  assert.equal(parseCategoryFields({ nama: 'X', jenis: 'lain' }).ok, false);
  assert.equal(parseCategoryFields(null).ok, false);
  assert.equal(parseCategoryFields({ nama: 'X', jenis: 'pengeluaran', kata_kunci: '<' }).ok, false);
});

test('parseOrder: unique positive ids, 1 to 200', () => {
  assert.deepEqual(parseOrder({ ids: [3, '1', 2] }), { ok: true, value: [3, 1, 2] });
  for (const bad of [null, {}, { ids: [] }, { ids: [1, 1] }, { ids: [0] }, { ids: ['x'] }, { ids: 'abc' }, { ids: Array.from({ length: 201 }, (_, i) => i + 1) }]) {
    assert.equal(parseOrder(bad).ok, false, JSON.stringify(bad)?.slice(0, 40));
  }
});

test('sortValues and nextSort: steps of 10, new ones go last', () => {
  assert.deepEqual(sortValues([7, 3]), [{ id: 7, sort: 10 }, { id: 3, sort: 20 }]);
  assert.equal(nextSort([]), 10);
  assert.equal(nextSort([null, 30, 10]), 40);
});

test('moveId: moves one id, clamps the position, ignores unknown ids', () => {
  assert.deepEqual(moveId([1, 2, 3, 4], 4, 0), [4, 1, 2, 3]);
  assert.deepEqual(moveId([1, 2, 3, 4], 1, 2), [2, 3, 1, 4]);
  assert.deepEqual(moveId([1, 2, 3], 2, -5), [2, 1, 3]);
  assert.deepEqual(moveId([1, 2, 3], 2, 99), [1, 3, 2]);
  assert.deepEqual(moveId([1, 2, 3], 9, 0), [1, 2, 3]);
});

test('isUnused: only when neither transactions nor budgets point at it', () => {
  assert.equal(isUnused({ transactions: 0, budgets: 0 }), true);
  assert.equal(isUnused({ transactions: 1, budgets: 0 }), false);
  assert.equal(isUnused({ transactions: 0, budgets: 2 }), false);
});
