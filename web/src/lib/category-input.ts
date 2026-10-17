// Checks what the category form sends. Shared by the page script (quick feedback) and the API
// routes (which never trust the browser). Pure, so it is unit tested.
import { parseId, type Parsed } from './budget-input.ts';

export const JENIS = ['pemasukan', 'pengeluaran'] as const;
export type Jenis = (typeof JENIS)[number];

export const MAX_NAME = 60;
export const MAX_KEYWORDS = 30;
export const MAX_KEYWORD = 40;
export const MAX_REORDER = 200;
export const SORT_STEP = 10;

/** A category name: one line, 1 to 60 characters, no angle brackets or control characters. */
export function normalizeCategoryName(input: unknown): string | null {
  if (typeof input !== 'string') return null;
  const name = input.replace(/\s+/g, ' ').trim();
  // eslint-disable-next-line no-control-regex
  if (name.length < 1 || name.length > MAX_NAME || /[<>\u0000-\u001f\u007f]/.test(name)) return null;
  return name;
}

/** Keywords the assistant uses as a hint. Accepts "kopi, nasi" or ["kopi","nasi"]; trims, drops blanks and repeats. */
export function parseKeywords(input: unknown): string[] | null {
  if (input === undefined || input === null || input === '') return [];
  const raw = Array.isArray(input) ? input : typeof input === 'string' ? input.split(',') : null;
  if (!raw) return null;
  const seen = new Set<string>();
  const out: string[] = [];
  for (const item of raw) {
    if (typeof item !== 'string') return null;
    const word = item.replace(/\s+/g, ' ').trim();
    if (!word) continue;
    // eslint-disable-next-line no-control-regex
    if (word.length > MAX_KEYWORD || /[<>\u0000-\u001f\u007f]/.test(word)) return null;
    const key = word.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(word);
  }
  return out.length > MAX_KEYWORDS ? null : out;
}

export interface CategoryInput {
  nama: string;
  jenis: Jenis;
  aktif: boolean;
  kata_kunci: string[];
}

export const isJenis = (value: unknown): value is Jenis => JENIS.includes(value as Jenis);

/** The editable part of a category. `aktif` defaults to true when it is not sent. */
export function parseCategoryFields(body: unknown): Parsed<CategoryInput> {
  const b = (body && typeof body === 'object' ? body : {}) as Record<string, unknown>;
  const nama = normalizeCategoryName(b.nama);
  if (!nama) return { ok: false, error: `Give the category a name of 1–${MAX_NAME} characters, without < or >` };
  if (!isJenis(b.jenis)) return { ok: false, error: 'Choose income or spending' };
  const kata_kunci = parseKeywords(b.kata_kunci);
  if (!kata_kunci) return { ok: false, error: `Keywords: up to ${MAX_KEYWORDS}, each up to ${MAX_KEYWORD} characters, separated by commas` };
  const aktif = b.aktif === undefined ? true : b.aktif === true || b.aktif === 'true' || b.aktif === 'on';
  return { ok: true, value: { nama, jenis: b.jenis, aktif, kata_kunci } };
}

/** The new order of a group of categories: a list of unique ids, first = top. */
export function parseOrder(body: unknown): Parsed<number[]> {
  const raw = body && typeof body === 'object' ? (body as Record<string, unknown>).ids : null;
  if (!Array.isArray(raw) || raw.length < 1 || raw.length > MAX_REORDER) return { ok: false, error: 'Send the categories in their new order' };
  const ids: number[] = [];
  for (const item of raw) {
    const id = parseId(item);
    if (!id || ids.includes(id)) return { ok: false, error: 'The order contains an invalid or repeated category' };
    ids.push(id);
  }
  return { ok: true, value: ids };
}

/** Sort values for an ordered list of ids: 10, 20, 30… (gaps leave room for hand edits in the CMS). */
export function sortValues(ids: number[]): { id: number; sort: number }[] {
  return ids.map((id, i) => ({ id, sort: (i + 1) * SORT_STEP }));
}

/** The sort value that puts a new category at the bottom of the list. */
export function nextSort(existing: (number | null)[]): number {
  return Math.max(0, ...existing.map((s) => (typeof s === 'number' ? s : 0))) + SORT_STEP;
}

export interface Usage {
  transactions: number;
  budgets: number;
}

export const isUnused = (u: Usage) => u.transactions === 0 && u.budgets === 0;

/** Moves one id to a new position in a list (used by drag and drop and by the keyboard). */
export function moveId(ids: number[], id: number, to: number): number[] {
  const from = ids.indexOf(id);
  if (from < 0) return ids;
  const next = ids.filter((x) => x !== id);
  next.splice(Math.max(0, Math.min(next.length, to)), 0, id);
  return next;
}
