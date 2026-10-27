// Pure helpers for connecting an account from /accounts. The browser only ever asks Directus (through
// our API) for a request row; the VPS script apply_account_requests.py does the OAuth work and re-checks
// everything. These checks are a convenience for the person, not the security boundary.

export const CONNECT_JOB_NAME = 'apply-account-requests';

const EMAIL = /^[A-Za-z0-9._%+'-]{1,64}@[A-Za-z0-9.-]{1,255}\.[A-Za-z]{2,}$/;
export const MAX_REDIRECT = 4000;

export type ConnectInput =
  | { action: 'start'; identifier: string; label: string | null }
  | { action: 'finish'; identifier: string; payload: string };

export type Parsed = { ok: true; data: ConnectInput } | { ok: false; error: string };

export function parseConnect(body: unknown): Parsed {
  const b = (body && typeof body === 'object' ? body : {}) as Record<string, unknown>;
  const identifier = typeof b.identifier === 'string' ? b.identifier.trim().toLowerCase() : '';
  if (!EMAIL.test(identifier) || identifier.length > 254) return { ok: false, error: 'That is not a valid email address.' };

  if (b.action === 'start') {
    const raw = typeof b.label === 'string' ? b.label.trim() : '';
    if (raw && (raw.length > 40 || /[\u0000-\u001f]/.test(raw))) return { ok: false, error: 'Give the account a short name (1 to 40 characters).' };
    return { ok: true, data: { action: 'start', identifier, label: raw || null } };
  }
  if (b.action === 'finish') {
    const payload = typeof b.redirect === 'string' ? b.redirect.trim() : '';
    if (!payload) return { ok: false, error: 'Paste the address of the page Google ended on.' };
    if (payload.length > MAX_REDIRECT) return { ok: false, error: 'That is too long to be the address Google gave you.' };
    return { ok: true, data: { action: 'finish', identifier, payload } };
  }
  return { ok: false, error: 'Invalid request' };
}

/** The consent link, only if it really points at Google's OAuth page (it is rendered as a clickable link). */
export function safeAuthUrl(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && url.hostname === 'accounts.google.com' && url.pathname.startsWith('/o/oauth2/') ? url.href : null;
  } catch {
    return null;
  }
}

export type RequestState = 'waiting' | 'done' | 'failed';

export function requestState(status: unknown): RequestState {
  return status === 'done' ? 'done' : status === 'failed' ? 'failed' : 'waiting';
}

/** Does this account row offer a Connect / Reconnect button? Anything that is not healthy does. */
export function connectLabel(status: string): 'Connect' | 'Reconnect' | null {
  if (status === 'connected') return null;
  return status === 'not_connected' ? 'Connect' : 'Reconnect';
}
