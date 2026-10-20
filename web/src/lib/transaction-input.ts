// Checks what the transaction form sends. Used by the page script (quick feedback) and the API
// routes (which never trust the browser). Pure, so it is unit tested.
import { parseAmount, parseId, type Parsed } from './budget-input.ts';
import { addDays, parseDate } from './finance.ts';

export const MAX_DESCRIPTION = 200;
export const EARLIEST_DATE = '2000-01-01';
export const JENIS = ['pemasukan', 'pengeluaran', 'tabungan'] as const;
export type Jenis = (typeof JENIS)[number];

export interface TransactionInput {
  tanggal: string;
  jenis: Jenis;
  kategori: number;
  deskripsi: string | null;
  nominal: number;
  member: number | null;
}

/** One line of text, up to 200 characters, no angle brackets or control characters. Empty -> null. */
export function normalizeDescription(input: unknown): { ok: true; value: string | null } | { ok: false } {
  if (input === undefined || input === null) return { ok: true, value: null };
  if (typeof input !== 'string') return { ok: false };
  const text = input.replace(/\s+/g, ' ').trim();
  // eslint-disable-next-line no-control-regex
  if (text.length > MAX_DESCRIPTION || /[<>\u0000-\u001f\u007f]/.test(text)) return { ok: false };
  return { ok: true, value: text || null };
}

/** The editable part of a transaction. `today` is the WIB calendar day; tomorrow is allowed for clock slack. */
export function parseTransactionFields(body: unknown, today: string): Parsed<TransactionInput> {
  const b = (body && typeof body === 'object' ? body : {}) as Record<string, unknown>;
  const tanggal = parseDate(b.tanggal);
  if (!tanggal) return { ok: false, error: 'Pick a date' };
  if (tanggal < EARLIEST_DATE) return { ok: false, error: 'That date is too far back' };
  if (tanggal > addDays(today, 1)) return { ok: false, error: 'The date is in the future' };
  const jenis = JENIS.find((j) => j === b.jenis);
  if (!jenis) return { ok: false, error: 'Choose income, expense or savings' };
  const kategori = parseId(b.kategori);
  if (!kategori) return { ok: false, error: 'Choose a category' };
  const nominal = parseAmount(b.nominal);
  if (!nominal) return { ok: false, error: 'Enter the amount in rupiah, for example 45.000' };
  const description = normalizeDescription(b.deskripsi);
  if (!description.ok) return { ok: false, error: `The description can be up to ${MAX_DESCRIPTION} characters, without < or >` };
  const member = b.member === undefined || b.member === null || b.member === '' ? null : parseId(b.member);
  if (b.member !== undefined && b.member !== null && b.member !== '' && !member) return { ok: false, error: 'Unknown person' };
  return { ok: true, value: { tanggal, jenis, kategori, deskripsi: description.value, nominal, member } };
}

/**
 * The `waktu` timestamp (UTC) for a transaction on `tanggal`: the real moment when it is today,
 * otherwise noon WIB of that day, so it always lands on the right WIB date.
 */
export function waktuFor(tanggal: string, today: string, nowMs = Date.now()): string {
  return tanggal === today ? new Date(nowMs).toISOString() : `${tanggal}T05:00:00.000Z`;
}
