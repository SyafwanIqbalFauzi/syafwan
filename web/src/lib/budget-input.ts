// Checks what the budget form sends. Shared by the page script (to give quick feedback) and
// the API routes (which never trust the browser). Pure, so it is unit tested.

export const MAX_AMOUNT = 1_000_000_000_000; // a trillion rupiah per month is far beyond any real budget
export const MIN_YEAR = 2000;
export const MAX_YEAR = 2100;

/** "5.450.000", "Rp 5,450,000", "300000" -> number. Rupiah has no decimals, so . , and spaces are separators. */
export function parseAmount(input: unknown): number | null {
  if (typeof input === 'number') return Number.isSafeInteger(input) && input > 0 && input <= MAX_AMOUNT ? input : null;
  if (typeof input !== 'string') return null;
  const digits = input.replace(/^\s*rp\.?\s*/i, '').replace(/[.,\s]/g, '');
  if (!/^\d{1,13}$/.test(digits)) return null;
  const value = Number(digits);
  return value > 0 && value <= MAX_AMOUNT ? value : null;
}

/** A budget line's name: one line, 1 to 80 characters, no angle brackets or control characters. */
export function normalizePos(input: unknown): string | null {
  if (typeof input !== 'string') return null;
  const name = input.replace(/\s+/g, ' ').trim();
  // eslint-disable-next-line no-control-regex
  if (name.length < 1 || name.length > 80 || /[<>\u0000-\u001f\u007f]/.test(name)) return null;
  return name;
}

export function parseYear(input: unknown): number | null {
  const year = typeof input === 'string' && /^\d{4}$/.test(input) ? Number(input) : input;
  return typeof year === 'number' && Number.isInteger(year) && year >= MIN_YEAR && year <= MAX_YEAR ? year : null;
}

export function parseId(input: unknown): number | null {
  const id = typeof input === 'string' && /^\d{1,9}$/.test(input) ? Number(input) : input;
  return typeof id === 'number' && Number.isInteger(id) && id > 0 ? id : null;
}

export interface BudgetInput {
  kategori: number;
  nama_pos: string;
  jumlah: number;
}

export type Parsed<T> = { ok: true; value: T } | { ok: false; error: string };

/** The editable part of a budget line: category, name and monthly amount. */
export function parseBudgetFields(body: unknown): Parsed<BudgetInput> {
  const b = (body && typeof body === 'object' ? body : {}) as Record<string, unknown>;
  const kategori = parseId(b.kategori);
  if (!kategori) return { ok: false, error: 'Choose a category' };
  const nama_pos = normalizePos(b.nama_pos);
  if (!nama_pos) return { ok: false, error: 'Give the line a name of 1–80 characters, without < or >' };
  const jumlah = parseAmount(b.jumlah);
  if (!jumlah) return { ok: false, error: 'Enter the monthly amount in rupiah, for example 450.000' };
  return { ok: true, value: { kategori, nama_pos, jumlah } };
}

export function sameName(a: string, b: string): boolean {
  return a.trim().toLowerCase() === b.trim().toLowerCase();
}
