// Checks what the Autoplay Blocker report form sends. Used by the page (which never trusts the
// browser). Pure, so it is unit tested.
import type { Parsed } from './budget-input.ts';

export const REPORT_KINDS = ['site_bug', 'question', 'privacy'] as const;
export type ReportKind = (typeof REPORT_KINDS)[number];
export const MIN_MESSAGE = 5;
export const MAX_MESSAGE = 2000;

export interface ReportInput {
  kind: ReportKind;
  site: string | null;
  version: string | null;
  message: string;
  email: string | null;
  lang: 'en' | 'id';
}

/** "https://www.Example.com/path?x" -> "example.com". Empty -> null; anything that is not a host -> false. */
export function normalizeSite(input: unknown): string | null | false {
  if (input === undefined || input === null) return null;
  if (typeof input !== 'string') return false;
  let text = input.trim().toLowerCase();
  if (!text) return null;
  text = text.replace(/^[a-z][a-z0-9+.-]*:\/\//, '').replace(/^www\./, '').split(/[/?#]/)[0].replace(/:\d+$/, '');
  return text.length <= 253 && /^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)*$/.test(text) ? text : false;
}

const normalizeVersion = (input: unknown): string | null => (typeof input === 'string' && /^\d{1,4}(\.\d{1,4}){0,3}$/.test(input.trim()) ? input.trim() : null);

/** A short note: control characters removed (new lines kept), outer space trimmed. */
function normalizeMessage(input: unknown): string | null {
  if (typeof input !== 'string') return null;
  // eslint-disable-next-line no-control-regex
  const text = input.replace(/\r\n?/g, '\n').replace(/[\u0000-\u0009\u000b-\u001f\u007f]/g, '').trim();
  return text.length >= MIN_MESSAGE && text.length <= MAX_MESSAGE ? text : null;
}

function normalizeEmail(input: unknown): string | null | false {
  if (input === undefined || input === null) return null;
  if (typeof input !== 'string') return false;
  const text = input.trim();
  if (!text) return null;
  return text.length <= 254 && /^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/.test(text) ? text : false;
}

/** `body` is the form as a plain object. A filled-in `website` field is the honeypot: reject quietly as a bot. */
export function parseReport(body: unknown): Parsed<ReportInput> | { ok: false; error: string; bot: true } {
  const b = (body && typeof body === 'object' ? body : {}) as Record<string, unknown>;
  if (typeof b.website === 'string' && b.website.trim() !== '') return { ok: false, error: 'Rejected', bot: true };
  const kind = REPORT_KINDS.find((k) => k === b.kind);
  if (!kind) return { ok: false, error: 'Choose what this is about' };
  const site = normalizeSite(b.site);
  if (site === false) return { ok: false, error: 'Enter just the site, for example example.com' };
  const message = normalizeMessage(b.message);
  if (!message) return { ok: false, error: `Write between ${MIN_MESSAGE} and ${MAX_MESSAGE} characters` };
  const email = normalizeEmail(b.email);
  if (email === false) return { ok: false, error: 'That email address does not look right' };
  const lang = b.lang === 'id' ? 'id' : 'en';
  return { ok: true, value: { kind, site, version: normalizeVersion(b.version), message, email, lang } };
}
