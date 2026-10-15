import assert from 'node:assert/strict';
import { test } from 'node:test';
import { normalizeDescription, parseTransactionFields, waktuFor } from '../src/lib/transaction-input.ts';

const TODAY = '2026-10-15';
const valid = { tanggal: '2026-10-14', jenis: 'pengeluaran', kategori: '4', deskripsi: '  kopi   susu ', nominal: '18.000', member: '1' };

test('a valid form is cleaned up', () => {
  assert.deepEqual(parseTransactionFields(valid, TODAY), { ok: true, value: { tanggal: '2026-10-14', jenis: 'pengeluaran', kategori: 4, deskripsi: 'kopi susu', nominal: 18000, member: 1 } });
});

test('the description is optional, and so is the person', () => {
  const parsed = parseTransactionFields({ ...valid, deskripsi: '   ', member: '' }, TODAY);
  assert.deepEqual(parsed.ok && [parsed.value.deskripsi, parsed.value.member], [null, null]);
  const missing = parseTransactionFields({ tanggal: '2026-10-14', jenis: 'pemasukan', kategori: 1, nominal: 5 }, TODAY);
  assert.equal(missing.ok, true);
});

test('each broken field gets its own message', () => {
  const error = (patch: Record<string, unknown>) => {
    const r = parseTransactionFields({ ...valid, ...patch }, TODAY);
    return r.ok ? 'ok' : r.error;
  };
  assert.match(error({ tanggal: '2026-02-30' }), /date/i);
  assert.match(error({ tanggal: '' }), /date/i);
  assert.match(error({ tanggal: '1999-12-31' }), /far back/i);
  assert.match(error({ tanggal: '2026-10-17' }), /future/i);
  assert.match(error({ jenis: 'transfer' }), /income or expense/i);
  assert.match(error({ kategori: '' }), /category/i);
  assert.match(error({ nominal: '0' }), /amount/i);
  assert.match(error({ nominal: 'banyak' }), /amount/i);
  assert.match(error({ deskripsi: '<script>' }), /description/i);
  assert.match(error({ deskripsi: 'x'.repeat(201) }), /description/i);
  assert.match(error({ member: 'abc' }), /person/i);
});

test('tomorrow is allowed (clock slack), the day after is not', () => {
  assert.equal(parseTransactionFields({ ...valid, tanggal: '2026-10-16' }, TODAY).ok, true);
  assert.equal(parseTransactionFields({ ...valid, tanggal: '2026-10-17' }, TODAY).ok, false);
});

test('unknown fields are ignored (no mass assignment)', () => {
  const parsed = parseTransactionFields({ ...valid, dihapus_pada: '2026-01-01', sumber: 'x', id: 5, waktu: 'now' }, TODAY);
  assert.deepEqual(Object.keys(parsed.ok ? parsed.value : {}).sort(), ['deskripsi', 'jenis', 'kategori', 'member', 'nominal', 'tanggal']);
});

test('normalizeDescription', () => {
  assert.deepEqual(normalizeDescription(undefined), { ok: true, value: null });
  assert.deepEqual(normalizeDescription('a\n b'), { ok: true, value: 'a b' });
  assert.deepEqual(normalizeDescription(5), { ok: false });
  assert.deepEqual(normalizeDescription('x\u0000'), { ok: false });
});

test('waktuFor: now for today, noon WIB for any other day (so the WIB date never shifts)', () => {
  const now = Date.parse('2026-10-15T03:25:00Z');
  assert.equal(waktuFor('2026-10-15', TODAY, now), '2026-10-15T03:25:00.000Z');
  assert.equal(waktuFor('2026-10-10', TODAY, now), '2026-10-10T05:00:00.000Z');
});
