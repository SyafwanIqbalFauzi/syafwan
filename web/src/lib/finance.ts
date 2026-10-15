// Money maths for the /agent finance pages. Everything here is pure: dates are plain
// `YYYY-MM-DD` strings (the `tanggal` column is already the WIB calendar day), so no time zone
// can shift a transaction into the wrong day.

export interface Trx {
  id?: number;
  tanggal: string;
  jenis: string; // 'pemasukan' (income) | 'pengeluaran' (expense)
  kategori: number | null;
  nominal: number | string;
  member?: number | null;
  deskripsi?: string | null;
}

export interface Category {
  id: number;
  nama: string;
  jenis: string;
}

export interface Budget {
  tahun: number;
  kategori: number;
  nama_pos: string;
  jumlah: number | string;
}

export type RangeKey = 'month' | '7d' | '14d' | '1m' | '3m' | '6m' | '1y';
export type Bucket = 'day' | 'week' | 'month';

export const RANGES: { key: RangeKey; label: string }[] = [
  { key: 'month', label: 'This month' },
  { key: '7d', label: '7 days' },
  { key: '14d', label: '14 days' },
  { key: '1m', label: '1 month' },
  { key: '3m', label: '3 months' },
  { key: '6m', label: '6 months' },
  { key: '1y', label: '1 year' },
];
export const DEFAULT_RANGE: RangeKey = '1m';
export const isRange = (value: unknown): value is RangeKey => RANGES.some((r) => r.key === value);

const INCOME = 'pemasukan';
const EXPENSE = 'pengeluaran';
const amount = (t: Pick<Trx, 'nominal'>) => Number(t.nominal) || 0;

// ---- dates ------------------------------------------------------------------------------------

const DAY = 86_400_000;
const toMs = (date: string) => Date.parse(`${date}T00:00:00Z`);
const fromMs = (ms: number) => new Date(ms).toISOString().slice(0, 10);

/** Today's calendar day in WIB (UTC+7). */
export function todayWib(now = Date.now()): string {
  return fromMs(now + 7 * 3_600_000);
}

export function addDays(date: string, days: number): string {
  return fromMs(toMs(date) + days * DAY);
}

export function daysBetween(from: string, to: string): number {
  return Math.round((toMs(to) - toMs(from)) / DAY);
}

/** First day of the month `shift` months from the month of `date` (negative = earlier). */
export function monthStart(date: string, shift = 0): string {
  const d = new Date(toMs(date));
  return fromMs(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + shift, 1));
}

export function monthEnd(date: string): string {
  return addDays(monthStart(date, 1), -1);
}

/** Monday of the week containing `date`. */
export function weekStart(date: string): string {
  const weekday = new Date(toMs(date)).getUTCDay(); // 0 = Sunday
  return addDays(date, -((weekday + 6) % 7));
}

export function bucketStart(date: string, bucket: Bucket): string {
  return bucket === 'day' ? date : bucket === 'week' ? weekStart(date) : monthStart(date);
}

export interface Window {
  start: string;
  end: string;
  prevStart: string;
  prevEnd: string;
  bucket: Bucket;
}

/** The period to chart, ending today, plus the equally long period right before it. */
export function windowFor(range: RangeKey, today: string): Window {
  if (range === 'month') {
    // The calendar month so far, compared with the same days of last month.
    const start = monthStart(today);
    const prevStart = monthStart(today, -1);
    const prevEnd = [addDays(prevStart, daysBetween(start, today)), addDays(start, -1)].sort()[0];
    return { start, end: today, prevStart, prevEnd, bucket: 'day' };
  }
  const days = { '7d': 7, '14d': 14, '1m': 30 } as const;
  if (range === '7d' || range === '14d' || range === '1m') {
    const n = days[range];
    const start = addDays(today, -(n - 1));
    return { start, end: today, prevStart: addDays(start, -n), prevEnd: addDays(start, -1), bucket: 'day' };
  }
  if (range === '3m') {
    const start = addDays(weekStart(today), -12 * 7); // 13 weeks, the current one included
    return { start, end: today, prevStart: addDays(start, -91), prevEnd: addDays(start, -1), bucket: 'week' };
  }
  const months = range === '6m' ? 6 : 12;
  const start = monthStart(today, -(months - 1));
  return { start, end: today, prevStart: monthStart(start, -months), prevEnd: addDays(start, -1), bucket: 'month' };
}

/** `YYYY-MM-DD` that is a real calendar day, or null. */
export function parseDate(value: unknown): string | null {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const ms = Date.parse(`${value}T00:00:00Z`);
  return Number.isNaN(ms) || fromMs(ms) !== value ? null : value;
}

/** Longest custom range that is drawn (the charts stay readable and the query stays small). */
export const MAX_SPAN_DAYS = 366 * 5;

/**
 * A window for a start and end date picked by hand. Only one end given: the end defaults to today,
 * the start to 30 days before the end. Dates in the wrong order are swapped. Null when neither is given.
 */
export function customWindow(from: string | null, to: string | null, today: string): Window | null {
  if (!from && !to) return null;
  let end = to ?? today;
  let start = from ?? addDays(end, -29);
  if (start > end) [start, end] = [end, start];
  if (daysBetween(start, end) + 1 > MAX_SPAN_DAYS) start = addDays(end, -(MAX_SPAN_DAYS - 1));
  const length = daysBetween(start, end) + 1;
  const bucket: Bucket = length <= 45 ? 'day' : length <= 150 ? 'week' : 'month';
  return { start, end, prevStart: addDays(start, -length), prevEnd: addDays(start, -1), bucket };
}

export function bucketKeys(start: string, end: string, bucket: Bucket): string[] {
  const keys: string[] = [];
  let cursor = bucketStart(start, bucket);
  while (cursor <= end) {
    keys.push(cursor);
    cursor = bucket === 'day' ? addDays(cursor, 1) : bucket === 'week' ? addDays(cursor, 7) : monthStart(cursor, 1);
  }
  return keys;
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

export function bucketLabel(key: string, bucket: Bucket): string {
  const [y, m, d] = key.split('-').map(Number);
  if (bucket === 'month') return `${MONTHS[m - 1]} ${String(y).slice(2)}`;
  return `${d} ${MONTHS[m - 1]}`;
}

// ---- totals -------------------------------------------------------------------------------------

export interface Totals {
  income: number;
  expense: number;
  net: number;
  count: number;
  /** Share of income that was kept, or null when there was no income */
  savingsRate: number | null;
}

export function summarize(trx: Trx[], from: string, to: string): Totals {
  let income = 0;
  let expense = 0;
  let count = 0;
  for (const t of trx) {
    if (t.tanggal < from || t.tanggal > to) continue;
    count++;
    if (t.jenis === INCOME) income += amount(t);
    else if (t.jenis === EXPENSE) expense += amount(t);
  }
  const net = income - expense;
  return { income, expense, net, count, savingsRate: income > 0 ? net / income : null };
}

/** Relative change from `previous` to `current`, or null when there is nothing to compare with. */
export function pctChange(current: number, previous: number): number | null {
  return previous > 0 ? (current - previous) / previous : null;
}

export interface CashflowPoint {
  key: string;
  label: string;
  income: number;
  expense: number;
  net: number;
  /** Running total of net from the start of the window */
  cumulative: number;
  /** The bucket is not over yet (today falls inside it) */
  partial: boolean;
}

export function cashflow(trx: Trx[], win: Pick<Window, 'start' | 'end' | 'bucket'>): CashflowPoint[] {
  const keys = bucketKeys(win.start, win.end, win.bucket);
  const points = new Map(keys.map((key) => [key, { key, label: bucketLabel(key, win.bucket), income: 0, expense: 0, net: 0, cumulative: 0, partial: false }]));
  for (const t of trx) {
    if (t.tanggal < win.start || t.tanggal > win.end) continue;
    const point = points.get(bucketStart(t.tanggal, win.bucket));
    if (!point) continue;
    if (t.jenis === INCOME) point.income += amount(t);
    else if (t.jenis === EXPENSE) point.expense += amount(t);
  }
  let running = 0;
  const list = [...points.values()];
  for (const point of list) {
    point.net = point.income - point.expense;
    running += point.net;
    point.cumulative = running;
  }
  if (win.bucket !== 'day') {
    // A bucket is partial when part of it lies outside the period: the running week/month, or a period that starts or ends mid-bucket.
    for (const point of list) {
      const last = win.bucket === 'week' ? addDays(point.key, 6) : monthEnd(point.key);
      point.partial = point.key < win.start || last > win.end;
    }
  }
  return list;
}

// ---- categories ---------------------------------------------------------------------------------

export interface CategoryShare {
  id: number | null;
  name: string;
  total: number;
  share: number;
  count: number;
}

/** Where the money went (jenis = 'pengeluaran') or came from ('pemasukan'), biggest first. */
export function byCategory(trx: Trx[], categories: Category[], jenis: string, from: string, to: string, top = 8): CategoryShare[] {
  const names = new Map(categories.map((c) => [c.id, c.nama]));
  const sums = new Map<number | null, { total: number; count: number }>();
  let all = 0;
  for (const t of trx) {
    if (t.jenis !== jenis || t.tanggal < from || t.tanggal > to) continue;
    const row = sums.get(t.kategori) ?? { total: 0, count: 0 };
    row.total += amount(t);
    row.count++;
    sums.set(t.kategori, row);
    all += amount(t);
  }
  const rows = [...sums]
    .map(([id, v]): CategoryShare => ({ id, name: id === null ? 'Uncategorised' : (names.get(id) ?? `Category ${id}`), total: v.total, share: all ? v.total / all : 0, count: v.count }))
    .sort((a, b) => b.total - a.total);
  if (rows.length <= top) return rows;
  const rest = rows.slice(top - 1);
  const other: CategoryShare = { id: null, name: `Other (${rest.length})`, total: rest.reduce((a, r) => a + r.total, 0), share: 0, count: rest.reduce((a, r) => a + r.count, 0) };
  other.share = all ? other.total / all : 0;
  return [...rows.slice(0, top - 1), other];
}

// ---- budgets ------------------------------------------------------------------------------------

export interface BudgetLine {
  kategori: number;
  name: string;
  planned: number;
  actual: number;
  /** actual / planned (0 when nothing is planned) */
  ratio: number;
  level: 'normal' | 'warning' | 'critical';
  /** The named items behind the planned amount, e.g. "KPR Rumah" */
  items: string[];
}

export interface BudgetReport {
  expenses: BudgetLine[];
  /** Budget lines on income categories (e.g. the salary): an expected income, not a spending limit */
  income: BudgetLine[];
  plannedExpense: number;
  actualOnBudgeted: number;
}

export function levelFor(ratio: number): BudgetLine['level'] {
  return ratio >= 1 ? 'critical' : ratio >= 0.8 ? 'warning' : 'normal';
}

/** Budgets are per month; compare them with what really happened between `from` and `to`. */
export function budgetReport(budgets: Budget[], categories: Category[], trx: Trx[], year: number, from: string, to: string): BudgetReport {
  const names = new Map(categories.map((c) => [c.id, c]));
  const planned = new Map<number, { total: number; items: string[] }>();
  for (const b of budgets) {
    if (b.tahun !== year) continue;
    const row = planned.get(b.kategori) ?? { total: 0, items: [] };
    row.total += Number(b.jumlah) || 0;
    row.items.push(b.nama_pos);
    planned.set(b.kategori, row);
  }
  const actualBy = (kategori: number, jenis: string) => trx.filter((t) => t.kategori === kategori && t.jenis === jenis && t.tanggal >= from && t.tanggal <= to).reduce((a, t) => a + amount(t), 0);

  const expenses: BudgetLine[] = [];
  const income: BudgetLine[] = [];
  for (const [kategori, row] of planned) {
    const category = names.get(kategori);
    const isIncome = category?.jenis === INCOME;
    const actual = actualBy(kategori, isIncome ? INCOME : EXPENSE);
    const ratio = row.total > 0 ? actual / row.total : 0;
    const line: BudgetLine = { kategori, name: category?.nama ?? `Category ${kategori}`, planned: row.total, actual, ratio, level: isIncome ? 'normal' : levelFor(ratio), items: row.items };
    (isIncome ? income : expenses).push(line);
  }
  expenses.sort((a, b) => b.ratio - a.ratio || a.name.localeCompare(b.name));
  income.sort((a, b) => a.name.localeCompare(b.name));
  return {
    expenses,
    income,
    plannedExpense: expenses.reduce((a, l) => a + l.planned, 0),
    actualOnBudgeted: expenses.reduce((a, l) => a + l.actual, 0),
  };
}

// ---- formatting ---------------------------------------------------------------------------------

const idNumber = new Intl.NumberFormat('id-ID', { maximumFractionDigits: 0 });
const idDecimal = new Intl.NumberFormat('id-ID', { maximumFractionDigits: 1 });

/** 1234567 -> "Rp 1.234.567" */
export function rupiah(n: number): string {
  return `${n < 0 ? '-' : ''}Rp ${idNumber.format(Math.abs(Math.round(n)))}`;
}

/** 12345678 -> "Rp 12,3 jt" (for chart axes and tight spaces) */
export function rupiahShort(n: number): string {
  const abs = Math.abs(n);
  const sign = n < 0 ? '-' : '';
  if (abs >= 1e9) return `${sign}Rp ${idDecimal.format(abs / 1e9)} M`;
  if (abs >= 1e6) return `${sign}Rp ${idDecimal.format(abs / 1e6)} jt`;
  if (abs >= 1e3) return `${sign}Rp ${idDecimal.format(abs / 1e3)} rb`;
  return `${sign}Rp ${Math.round(abs)}`;
}

export function percent(ratio: number | null, digits = 0): string {
  return ratio === null || !Number.isFinite(ratio) ? '—' : `${(ratio * 100).toFixed(digits)}%`;
}

/** "+12%" / "-5%" / "—" */
export function signedPercent(ratio: number | null): string {
  if (ratio === null || !Number.isFinite(ratio)) return '—';
  const value = Math.round(ratio * 100);
  return `${value > 0 ? '+' : ''}${value}%`;
}

// ---- periods for the transaction list -------------------------------------------------------------

export type PeriodKey = 'month' | 'last-month' | '30d' | '90d' | 'year' | 'all';

export const PERIODS: { key: PeriodKey; label: string }[] = [
  { key: 'month', label: 'This month' },
  { key: 'last-month', label: 'Last month' },
  { key: '30d', label: 'Last 30 days' },
  { key: '90d', label: 'Last 90 days' },
  { key: 'year', label: 'This year' },
  { key: 'all', label: 'All time' },
];
export const DEFAULT_PERIOD: PeriodKey = '30d';
export const isPeriod = (value: unknown): value is PeriodKey => PERIODS.some((p) => p.key === value);

/** The dates the transaction list shows: hand-picked ones win over the preset; an open end stays open. */
export function resolvePeriod(key: PeriodKey, from: string | null, to: string | null, today: string): { from: string | null; to: string | null; custom: boolean } {
  if (!from && !to) return { ...periodBounds(key, today), custom: false };
  const [a, b] = from && to && from > to ? [to, from] : [from, to];
  return { from: a, to: b, custom: true };
}

/** Inclusive date bounds of a period; `null` means open-ended. */
export function periodBounds(key: PeriodKey, today: string): { from: string | null; to: string | null } {
  switch (key) {
    case 'month':
      return { from: monthStart(today), to: monthEnd(today) };
    case 'last-month':
      return { from: monthStart(today, -1), to: addDays(monthStart(today), -1) };
    case '30d':
      return { from: addDays(today, -29), to: today };
    case '90d':
      return { from: addDays(today, -89), to: today };
    case 'year':
      return { from: `${today.slice(0, 4)}-01-01`, to: `${today.slice(0, 4)}-12-31` };
    default:
      return { from: null, to: null };
  }
}
