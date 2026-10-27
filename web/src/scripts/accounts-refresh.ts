// "Check now" on /accounts: runs the account check now, waits for newer statuses, reloads.
import { toast } from './toast';

export {};
const button = document.querySelector<HTMLButtonElement>('[data-accounts-refresh]');
const POLL_MS = 3_000;
const GIVE_UP_MS = 120_000;

const isNewer = (before: string | null, after: string | null): boolean => {
  const a = after ? Date.parse(after) : NaN;
  if (Number.isNaN(a)) return false;
  const b = before ? Date.parse(before) : NaN;
  return Number.isNaN(b) || a > b;
};

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function call(method: 'GET' | 'POST'): Promise<Response> {
  const res = await fetch('/api/accounts/refresh', {
    method,
    headers: method === 'POST' ? { 'Content-Type': 'application/json' } : undefined,
    body: method === 'POST' ? '{}' : undefined,
    credentials: 'same-origin',
  });
  if (res.status === 401) {
    location.href = '/agent/login?next=/accounts';
    throw new Error('Signed out');
  }
  return res;
}

button?.addEventListener('click', async () => {
  const label = button.textContent;
  const before = button.dataset.checkedAt || null;
  button.disabled = true;
  button.textContent = 'Checking…';
  try {
    const start = await call('POST');
    if (!start.ok) {
      const data = await start.json().catch(() => null);
      throw new Error(data?.error ?? `Request failed (${start.status})`);
    }
    const until = Date.now() + GIVE_UP_MS;
    let fresh = false;
    while (Date.now() < until) {
      await sleep(POLL_MS);
      const res = await call('GET').catch(() => null);
      const data = res?.ok ? await res.json().catch(() => null) : null;
      if (data && isNewer(before, data.checkedAt)) {
        fresh = true;
        break;
      }
    }
    if (!fresh) toast('The check is taking longer than expected. Showing the latest statuses available.', 'error');
    location.reload();
  } catch (error) {
    toast((error as Error).message, 'error');
    button.disabled = false;
    button.textContent = label;
  }
});
