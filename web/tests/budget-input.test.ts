import assert from 'node:assert/strict';
import { test } from 'node:test';
import { normalizePos, parseAmount, parseBudgetFields, parseId, parseYear, sameName } from '../src/lib/budget-input.ts';

test('parseAmount: Indonesian and plain number formats', () => {
  assert.equal(parseAmount('450000'), 450000);
  assert.equal(parseAmount('5.450.000'), 5450000);
  assert.equal(parseAmount('Rp 5,450,000'), 5450000);
  assert.equal(parseAmount(' rp. 300.000 '), 300000);
  assert.equal(parseAmount(12000000), 12000000);
});

test('parseAmount: refuses zero, negatives, decimals, text and absurd sizes', () => {
  for (const bad of ['0', '-5', '', '  ', 'abc', '12abc', '1e6', '5000x', null, undefined, {}, [], 0, -1, 1.5, 2 ** 60, '99999999999999']) {
    assert.equal(parseAmount(bad), null, String(bad));
  }
});

test('normalizePos: trims, collapses spaces, refuses markup and control characters', () => {
  assert.equal(normalizePos('  KPR   Rumah '), 'KPR Rumah');
  assert.equal(normalizePos('SPP Khafa'), 'SPP Khafa');
  for (const bad of ['', '   ', '<b>x</b>', 'a'.repeat(81), 'x\u0000y', 5, null]) assert.equal(normalizePos(bad), null);
  assert.equal(normalizePos('a'.repeat(80))?.length, 80);
});

test('parseYear and parseId', () => {
  assert.equal(parseYear('2026'), 2026);
  assert.equal(parseYear(2026), 2026);
  for (const bad of ['26', '1999', '2101', 'abcd', 2026.5, null]) assert.equal(parseYear(bad), null);
  assert.equal(parseId('12'), 12);
  assert.equal(parseId(7), 7);
  for (const bad of ['0', '-1', '1.5', 'x', '1234567890', null, 0]) assert.equal(parseId(bad), null);
});

test('parseBudgetFields: a valid form, and a clear error for each missing part', () => {
  assert.deepEqual(parseBudgetFields({ kategori: '6', nama_pos: ' Internet ', jumlah: '300.000' }), { ok: true, value: { kategori: 6, nama_pos: 'Internet', jumlah: 300000 } });
  assert.match((parseBudgetFields({ nama_pos: 'x', jumlah: 1 }) as { error: string }).error, /category/i);
  assert.match((parseBudgetFields({ kategori: 1, nama_pos: '', jumlah: 1 }) as { error: string }).error, /name/i);
  assert.match((parseBudgetFields({ kategori: 1, nama_pos: 'x', jumlah: 'lots' }) as { error: string }).error, /amount/i);
  assert.equal(parseBudgetFields(null).ok, false);
  assert.equal(parseBudgetFields('nope').ok, false);
});

test('parseBudgetFields: ignores fields it does not know (no mass assignment)', () => {
  const parsed = parseBudgetFields({ kategori: 1, nama_pos: 'x', jumlah: 5, tahun: 1900, id: 99, dihapus: true });
  assert.deepEqual(parsed, { ok: true, value: { kategori: 1, nama_pos: 'x', jumlah: 5 } });
});

test('sameName: case and spacing do not make a duplicate look different', () => {
  assert.equal(sameName('KPR Rumah', ' kpr rumah '), true);
  assert.equal(sameName('KPR', 'KPR Rumah'), false);
});
