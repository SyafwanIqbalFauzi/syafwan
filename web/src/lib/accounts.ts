// Shapes the connected-account rows (Directus `connected_accounts`, filled by the VPS script
// scripts/hermes/sync_accounts.py) for display. Pure so it can be tested; the page only paints this.
// The rows hold no secrets: provider, address, status, granted scopes and timestamps.

export interface AccountRow {
  id: number;
  provider: string;
  identifier: string;
  label: string | null;
  status: string;
  scopes: string[] | null;
  detail: string | null;
  checked_at: string | null;
  last_ok_at: string | null;
}

export type Tone = 'ok' | 'idle' | 'fail';

export interface AccountView {
  id: number;
  provider: string;
  providerLabel: string;
  identifier: string;
  label: string;
  status: string;
  statusLabel: string;
  tone: Tone;
  /** Needs a person: reconnect, or connect for the first time */
  needsAction: boolean;
  detail: string | null;
  scopes: string[];
  checkedAt: string | null;
  lastOkAt: string | null;
  /** Said "connected" but the VPS has not checked for a while, so it may have changed since */
  stale: boolean;
}

export interface AccountsView {
  accounts: AccountView[];
  connected: number;
  needAction: number;
  checkedAt: string | null;
}

/** The sync runs every 30 minutes; three missed runs and the status is shown as possibly out of date. */
export const STALE_AFTER_MS = 90 * 60_000;

const PROVIDERS: Record<string, string> = { google: 'Google' };

const STATUS: Record<string, { label: string; tone: Tone; action: boolean }> = {
  connected: { label: 'Connected', tone: 'ok', action: false },
  revoked: { label: 'Reconnect needed', tone: 'fail', action: true },
  mismatch: { label: 'Wrong account', tone: 'fail', action: true },
  not_connected: { label: 'Not connected', tone: 'idle', action: true },
  error: { label: 'Check failed', tone: 'fail', action: false },
};

export function providerLabel(provider: string): string {
  return PROVIDERS[provider] ?? provider.charAt(0).toUpperCase() + provider.slice(1);
}

/** "https://www.googleapis.com/auth/gmail.send" -> "gmail.send"; anything else is kept as is. */
export function shortScope(scope: string): string {
  return scope.replace(/^https:\/\/www\.googleapis\.com\/auth\//, '');
}

export function accountView(row: AccountRow, now = Date.now()): AccountView {
  const known = STATUS[row.status] ?? { label: row.status || 'Unknown', tone: 'fail' as Tone, action: false };
  const checked = row.checked_at ? Date.parse(row.checked_at) : NaN;
  return {
    id: row.id,
    provider: row.provider,
    providerLabel: providerLabel(row.provider),
    identifier: row.identifier,
    label: row.label || row.identifier,
    status: row.status,
    statusLabel: known.label,
    tone: known.tone,
    needsAction: known.action,
    detail: row.detail || null,
    scopes: (row.scopes ?? []).map(shortScope).sort(),
    checkedAt: row.checked_at,
    lastOkAt: row.last_ok_at,
    stale: row.status === 'connected' && (Number.isNaN(checked) || now - checked > STALE_AFTER_MS),
  };
}

/** Accounts that need attention first, then by provider and label. */
export function accountsView(rows: AccountRow[] | null | undefined, now = Date.now()): AccountsView {
  const accounts = (rows ?? []).map((r) => accountView(r, now));
  accounts.sort((a, b) => Number(b.needsAction || b.tone === 'fail') - Number(a.needsAction || a.tone === 'fail') || a.providerLabel.localeCompare(b.providerLabel) || a.label.localeCompare(b.label));
  let checkedAt: string | null = null;
  let best = -Infinity;
  for (const a of accounts) {
    const t = a.checkedAt ? Date.parse(a.checkedAt) : NaN;
    if (!Number.isNaN(t) && t > best) {
      best = t;
      checkedAt = a.checkedAt;
    }
  }
  return {
    accounts,
    connected: accounts.filter((a) => a.status === 'connected').length,
    needAction: accounts.filter((a) => a.needsAction || a.tone === 'fail').length,
    checkedAt,
  };
}
