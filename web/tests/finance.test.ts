import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  addDays,
  bucketKeys,
  budgetReport,
  byCategory,
  cashflow,
  monthStart,
  pctChange,
  rupiah,
  rupiahShort,
  signedPercent,
  summarize,
  todayWib,
  weekStart,
  windowFor,
  type Budget,
  type Category,
  type Trx,
} from '../src/lib/finance.ts';

const cats: Category[] = [
  { id: 1, nama: 'Gaji', jenis: 'pemasukan' },
  { id: 4, nama: 'Makan', jenis: 'pengeluaran' },
  { id: 6, nama: 'Tagihan', jenis: 'pengeluaran' },
];
const t = (tanggal: string, jenis: string, nominal: number, kategori: number | null = 4): Trx => ({ tanggal, jenis, nominal, kategori });

test('todayWib: the Indonesian date, not the UTC one', () => {
  assert.equal(todayWib(Date.parse('2026-10-15T18:00:00Z')), '2026-10-16'); // 01:00 WIB next day
  assert.equal(todayWib(Date.parse('2026-10-15T16:59:00Z')), '2026-10-15');
});

test('date helpers: week starts on Monday, months roll over years', () => {
  assert.equal(weekStart('2026-10-15'), '2026-10-12'); // Thursday
  assert.equal(weekStart('2026-10-18'), '2026-10-12'); // Sunday belongs to the week before
  assert.equal(weekStart('2026-10-12'), '2026-10-12');
  assert.equal(monthStart('2026-01-20', -1), '2025-12-01');
  assert.equal(monthStart('2026-10-15', -5), '2026-05-01');
  assert.equal(addDays('2026-02-28', 1), '2026-03-01');
});

test('windowFor: day ranges are exactly N days with an equal previous period', () => {
  for (const [range, n] of [['7d', 7], ['14d', 14], ['1m', 30]] as const) {
    const w = windowFor(range, '2026-10-15');
    assert.equal(w.end, '2026-10-15');
    assert.equal(bucketKeys(w.start, w.end, w.bucket).length, n);
    assert.equal(w.bucket, 'day');
    assert.equal(addDays(w.prevEnd, 1), w.start);
    assert.equal(bucketKeys(w.prevStart, w.prevEnd, 'day').length, n);
  }
});

test('windowFor: 3 months = 13 weeks, 6 months and a year are whole calendar months', () => {
  const w3 = windowFor('3m', '2026-10-15');
  assert.equal(w3.bucket, 'week');
  assert.equal(w3.start, '2026-07-20'); // Monday, 12 weeks before 12 Oct
  assert.equal(bucketKeys(w3.start, w3.end, 'week').length, 13);
  assert.equal(addDays(w3.prevEnd, 1), w3.start);

  const w6 = windowFor('6m', '2026-10-15');
  assert.deepEqual([w6.start, w6.bucket, w6.prevStart, w6.prevEnd], ['2026-05-01', 'month', '2025-11-01', '2026-04-30']);
  assert.equal(bucketKeys(w6.start, w6.end, 'month').length, 6);

  const w12 = windowFor('1y', '2026-10-15');
  assert.deepEqual([w12.start, w12.prevStart, w12.prevEnd], ['2025-11-01', '2024-11-01', '2025-10-31']);
  assert.equal(bucketKeys(w12.start, w12.end, 'month').length, 12);
});

test('summarize: income, expense, net and savings rate inside the dates only', () => {
  const rows = [t('2026-10-01', 'pemasukan', 1000, 1), t('2026-10-02', 'pengeluaran', 400), t('2026-10-03', 'pengeluaran', 100), t('2026-09-30', 'pengeluaran', 999), t('2026-10-10', 'pengeluaran', 999)];
  assert.deepEqual(summarize(rows, '2026-10-01', '2026-10-05'), { income: 1000, expense: 500, net: 500, count: 3, savingsRate: 0.5 });
  assert.equal(summarize([], '2026-10-01', '2026-10-05').savingsRate, null);
  assert.equal(summarize([t('2026-10-02', 'pengeluaran', 5)], '2026-10-01', '2026-10-05').savingsRate, null);
});

test('summarize: nominal arrives as a string from Directus (bigInteger)', () => {
  assert.equal(summarize([{ ...t('2026-10-01', 'pengeluaran', 0), nominal: '153591' }], '2026-10-01', '2026-10-01').expense, 153591);
});

test('pctChange: needs something before to compare with', () => {
  assert.equal(pctChange(150, 100), 0.5);
  assert.equal(pctChange(50, 100), -0.5);
  assert.equal(pctChange(10, 0), null);
  assert.equal(signedPercent(0.123), '+12%');
  assert.equal(signedPercent(-0.05), '-5%');
  assert.equal(signedPercent(null), '—');
});

test('cashflow: every day appears, empty ones are zero, cumulative net runs on', () => {
  const rows = [t('2026-10-13', 'pemasukan', 1000, 1), t('2026-10-13', 'pengeluaran', 300), t('2026-10-15', 'pengeluaran', 200)];
  const points = cashflow(rows, { start: '2026-10-13', end: '2026-10-15', bucket: 'day' });
  assert.deepEqual(points.map((p) => [p.key, p.income, p.expense, p.cumulative]), [
    ['2026-10-13', 1000, 300, 700],
    ['2026-10-14', 0, 0, 700],
    ['2026-10-15', 0, 200, 500],
  ]);
  assert.equal(points.some((p) => p.partial), false); // days are never partial
});

test('cashflow: weekly and monthly buckets add up, the running bucket is partial', () => {
  const rows = [t('2026-10-05', 'pengeluaran', 100), t('2026-10-11', 'pengeluaran', 50), t('2026-10-12', 'pengeluaran', 25), t('2026-09-30', 'pengeluaran', 7)];
  const weeks = cashflow(rows, { start: '2026-09-28', end: '2026-10-15', bucket: 'week' });
  assert.deepEqual(weeks.map((p) => [p.key, p.expense]), [['2026-09-28', 7], ['2026-10-05', 150], ['2026-10-12', 25]]);
  assert.equal(weeks.at(-1)!.partial, true);
  const months = cashflow(rows, { start: '2026-09-01', end: '2026-10-15', bucket: 'month' });
  assert.deepEqual(months.map((p) => [p.label, p.expense]), [['Sep 26', 7], ['Oct 26', 175]]);
});

test('byCategory: biggest first, shares add up, long tails collapse into "Other"', () => {
  const rows = [t('2026-10-01', 'pengeluaran', 600, 4), t('2026-10-02', 'pengeluaran', 300, 6), t('2026-10-03', 'pengeluaran', 100, null), t('2026-10-03', 'pemasukan', 5000, 1)];
  const list = byCategory(rows, cats, 'pengeluaran', '2026-10-01', '2026-10-31');
  assert.deepEqual(list.map((c) => [c.name, c.total, Math.round(c.share * 100)]), [['Makan', 600, 60], ['Tagihan', 300, 30], ['Uncategorised', 100, 10]]);
  const many: Trx[] = Array.from({ length: 12 }, (_, i) => t('2026-10-01', 'pengeluaran', 100 + i, 100 + i));
  const folded = byCategory(many, [], 'pengeluaran', '2026-10-01', '2026-10-31', 5);
  assert.equal(folded.length, 5);
  assert.equal(folded.at(-1)!.name, 'Other (8)');
  assert.equal(Math.round(folded.reduce((a, c) => a + c.share, 0) * 1000), 1000);
});

test('budgetReport: spending is compared per category; income lines are targets, not limits', () => {
  const budgets: Budget[] = [
    { tahun: 2026, kategori: 1, nama_pos: 'Gaji', jumlah: '12000000' },
    { tahun: 2026, kategori: 6, nama_pos: 'Internet', jumlah: '300000' },
    { tahun: 2026, kategori: 6, nama_pos: 'Listrik', jumlah: '250000' },
    { tahun: 2025, kategori: 4, nama_pos: 'Old year', jumlah: '1' },
  ];
  const rows = [t('2026-10-02', 'pengeluaran', 500_000, 6), t('2026-10-03', 'pengeluaran', 100_000, 6), t('2026-10-01', 'pemasukan', 3_000_000, 1), t('2026-09-20', 'pengeluaran', 9_999_999, 6)];
  const report = budgetReport(budgets, cats, rows, 2026, '2026-10-01', '2026-10-31');
  assert.equal(report.expenses.length, 1);
  assert.deepEqual([report.expenses[0].name, report.expenses[0].planned, report.expenses[0].actual, report.expenses[0].level], ['Tagihan', 550_000, 600_000, 'critical']);
  assert.deepEqual(report.expenses[0].items, ['Internet', 'Listrik']);
  assert.deepEqual([report.income[0].name, report.income[0].planned, report.income[0].actual], ['Gaji', 12_000_000, 3_000_000]);
  assert.equal(report.income[0].level, 'normal');
  assert.equal(report.plannedExpense, 550_000);
});

test('formatting: rupiah in Indonesian style', () => {
  assert.equal(rupiah(1234567), 'Rp 1.234.567');
  assert.equal(rupiah(-50000), '-Rp 50.000');
  assert.equal(rupiahShort(12_345_678), 'Rp 12,3 jt');
  assert.equal(rupiahShort(450_000), 'Rp 450 rb');
  assert.equal(rupiahShort(1_500_000_000), 'Rp 1,5 M');
  assert.equal(rupiahShort(900), 'Rp 900');
});

test('periodBounds: presets map to inclusive WIB dates', async () => {
  const { periodBounds } = await import('../src/lib/finance.ts');
  assert.deepEqual(periodBounds('month', '2026-10-15'), { from: '2026-10-01', to: '2026-10-31' });
  assert.deepEqual(periodBounds('last-month', '2026-10-15'), { from: '2026-09-01', to: '2026-09-30' });
  assert.deepEqual(periodBounds('last-month', '2026-01-10'), { from: '2025-12-01', to: '2025-12-31' });
  assert.deepEqual(periodBounds('30d', '2026-10-15'), { from: '2026-09-16', to: '2026-10-15' });
  assert.deepEqual(periodBounds('90d', '2026-10-15'), { from: '2026-07-18', to: '2026-10-15' });
  assert.deepEqual(periodBounds('year', '2026-10-15'), { from: '2026-01-01', to: '2026-12-31' });
  assert.deepEqual(periodBounds('all', '2026-10-15'), { from: null, to: null });
});

test('windowFor: this month = the month so far, compared with the same days of last month', () => {
  const w = windowFor('month', '2026-10-15');
  assert.deepEqual([w.start, w.end, w.bucket, w.prevStart, w.prevEnd], ['2026-10-01', '2026-10-15', 'day', '2026-09-01', '2026-09-15']);
  // the 31st compared with a 30-day month stops at that month's end
  const late = windowFor('month', '2026-10-31');
  assert.deepEqual([late.prevStart, late.prevEnd], ['2026-09-01', '2026-09-30']);
  const first = windowFor('month', '2026-03-01');
  assert.deepEqual([first.start, first.end, first.prevStart, first.prevEnd], ['2026-03-01', '2026-03-01', '2026-02-01', '2026-02-01']);
});

test('parseDate: only real calendar days', async () => {
  const { parseDate } = await import('../src/lib/finance.ts');
  assert.equal(parseDate('2026-10-15'), '2026-10-15');
  assert.equal(parseDate('2028-02-29'), '2028-02-29');
  for (const bad of ['2026-02-30', '2026-13-01', '2026-1-5', '15-10-2026', '', 'today', null, 20261015]) assert.equal(parseDate(bad), null, String(bad));
});

test('customWindow: hand-picked dates, with sensible defaults and limits', async () => {
  const { customWindow, MAX_SPAN_DAYS, daysBetween } = await import('../src/lib/finance.ts');
  assert.equal(customWindow(null, null, '2026-10-15'), null);
  const a = customWindow('2026-10-01', '2026-10-10', '2026-10-15')!;
  assert.deepEqual([a.start, a.end, a.bucket, a.prevStart, a.prevEnd], ['2026-10-01', '2026-10-10', 'day', '2026-09-21', '2026-09-30']);
  // only a start: runs to today; only an end: starts 30 days earlier
  assert.equal(customWindow('2026-10-01', null, '2026-10-15')!.end, '2026-10-15');
  assert.deepEqual([customWindow(null, '2026-10-15', '2026-10-20')!.start, customWindow(null, '2026-10-15', '2026-10-20')!.end], ['2026-09-16', '2026-10-15']);
  // reversed dates are swapped
  assert.deepEqual([customWindow('2026-10-10', '2026-10-01', '2026-10-15')!.start, customWindow('2026-10-10', '2026-10-01', '2026-10-15')!.end], ['2026-10-01', '2026-10-10']);
  // the longer the period, the coarser the buckets
  assert.equal(customWindow('2026-08-01', '2026-10-15', '2026-10-15')!.bucket, 'week');
  assert.equal(customWindow('2025-01-01', '2026-10-15', '2026-10-15')!.bucket, 'month');
  // a huge span is cut to the limit
  const long = customWindow('1990-01-01', '2026-10-15', '2026-10-15')!;
  assert.equal(daysBetween(long.start, long.end) + 1, MAX_SPAN_DAYS);
});

test('resolvePeriod: typed dates win over the preset and may stay open', async () => {
  const { resolvePeriod } = await import('../src/lib/finance.ts');
  assert.deepEqual(resolvePeriod('month', null, null, '2026-10-15'), { from: '2026-10-01', to: '2026-10-31', custom: false });
  assert.deepEqual(resolvePeriod('month', '2026-01-01', '2026-03-31', '2026-10-15'), { from: '2026-01-01', to: '2026-03-31', custom: true });
  assert.deepEqual(resolvePeriod('month', '2026-01-01', null, '2026-10-15'), { from: '2026-01-01', to: null, custom: true });
  assert.deepEqual(resolvePeriod('all', null, '2026-03-31', '2026-10-15'), { from: null, to: '2026-03-31', custom: true });
  assert.deepEqual(resolvePeriod('all', '2026-05-01', '2026-02-01', '2026-10-15'), { from: '2026-02-01', to: '2026-05-01', custom: true });
});

test('cashflow: a period that starts or ends mid-week marks those weeks as partial', async () => {
  const { cashflow } = await import('../src/lib/finance.ts');
  const points = cashflow([], { start: '2026-08-05', end: '2026-08-30', bucket: 'week' });
  assert.deepEqual(points.map((p) => [p.key, p.partial]), [['2026-08-03', true], ['2026-08-10', false], ['2026-08-17', false], ['2026-08-24', false]]);
  const full = cashflow([], { start: '2026-08-03', end: '2026-08-16', bucket: 'week' });
  assert.deepEqual(full.map((p) => p.partial), [false, false]); // ends on a Sunday: nothing is cut off
});
