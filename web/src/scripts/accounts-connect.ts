// Connect / reconnect a Google account from /accounts. The browser only talks to our API, which records a
// request for the server to carry out; no token or secret ever reaches this page.
//   1. "Get link"  -> the server prepares the Google sign-in link
//   2. the person signs in at Google and pastes back the address of the page Google ends on
//   3. "Connect"   -> the server finishes, checks it is the right account, saves it, and re-checks all accounts
import { delegate, refresh } from './live';
import { toast } from './toast';

export {};
const dialog = document.querySelector<HTMLDialogElement>('#connect-dialog');
const form = dialog?.querySelector<HTMLFormElement>('[data-connect-form]');
if (dialog && form) init(dialog, form);

type Step = 'form' | 'waiting' | 'link';
const POLL_MS = 2_000;
const GIVE_UP_MS = 180_000;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const isNewer = (before: string | null, after: string | null): boolean => {
  const a = after ? Date.parse(after) : NaN;
  if (Number.isNaN(a)) return false;
  const b = before ? Date.parse(before) : NaN;
  return Number.isNaN(b) || a > b;
};

function init(dialog: HTMLDialogElement, form: HTMLFormElement) {
  const $ = <T extends HTMLElement>(sel: string) => dialog.querySelector<T>(sel)!;
  const title = $('[data-connect-title]');
  const error = $('[data-connect-error]');
  const submit = $<HTMLButtonElement>('[data-connect-submit]');
  const nameField = $('[data-name-field]');
  const nameInput = form.elements.namedItem('label') as HTMLInputElement;
  const emailInput = form.elements.namedItem('identifier') as HTMLInputElement;
  const redirectInput = form.elements.namedItem('redirect') as HTMLTextAreaElement;
  const link = $<HTMLAnchorElement>('[data-link]');
  const waitText = $('[data-wait-text]');
  let step: Step = 'form';
  let reconnect = false;
  let busy = false;

  const show = (next: Step) => {
    step = next;
    dialog.querySelectorAll<HTMLElement>('[data-step]').forEach((el) => (el.hidden = el.dataset.step !== next));
    submit.hidden = next === 'waiting';
    submit.textContent = next === 'link' ? 'Connect' : 'Get link';
  };
  const fail = (message: string) => {
    error.textContent = message;
  };

  const open = (identifier: string, name: string) => {
    reconnect = Boolean(identifier);
    form.reset();
    emailInput.value = identifier;
    emailInput.readOnly = reconnect;
    nameInput.value = name;
    nameField.hidden = reconnect;
    title.textContent = reconnect ? `Reconnect ${name}` : 'Add a Google account';
    fail('');
    busy = false;
    show('form');
    dialog.showModal();
  };

  delegate<HTMLButtonElement>('click', '[data-connect-open]', (button) => open(button.dataset.identifier ?? '', button.dataset.name ?? ''));
  dialog.querySelector('[data-cancel]')?.addEventListener('click', () => dialog.close());

  async function api(method: 'GET' | 'POST', path: string, body?: unknown): Promise<Response> {
    const res = await fetch(path, {
      method,
      headers: body ? { 'Content-Type': 'application/json' } : undefined,
      body: body ? JSON.stringify(body) : undefined,
      credentials: 'same-origin',
    });
    if (res.status === 401) {
      location.href = '/agent/login?next=/accounts';
      throw new Error('Signed out');
    }
    return res;
  }

  /** Send a request and wait for the server's answer. */
  async function ask(body: Record<string, unknown>): Promise<{ state: string; url?: string; message?: string }> {
    const sent = await api('POST', '/api/accounts/connect', body);
    const first = await sent.json().catch(() => null);
    if (!sent.ok) throw new Error(first?.error ?? `Request failed (${sent.status})`);
    const until = Date.now() + GIVE_UP_MS;
    const slow = setTimeout(() => {
      if (step === 'waiting' && !waitText.textContent?.includes('minute or two')) waitText.textContent += ' This can take a minute or two.';
    }, 20_000);
    try {
      while (Date.now() < until) {
        await sleep(POLL_MS);
        const res = await api('GET', `/api/accounts/connect/${first.id}`).catch(() => null);
        const data = res?.ok ? await res.json().catch(() => null) : null;
        if (data && data.state !== 'waiting') return data;
      }
    } finally {
      clearTimeout(slow);
    }
    throw new Error('The server did not answer in time. Try again in a minute.');
  }

  async function refreshAfterConnect() {
    const button = document.querySelector<HTMLButtonElement>('[data-accounts-refresh]');
    const before = button?.dataset.checkedAt || null;
    const until = Date.now() + 60_000;
    while (Date.now() < until) {
      await sleep(3_000);
      const res = await api('GET', '/api/accounts/refresh').catch(() => null);
      const data = res?.ok ? await res.json().catch(() => null) : null;
      if (data && isNewer(before, data.checkedAt)) break;
    }
    await refresh();
    show('form'); // so closing the dialog is not taken for giving up
    dialog.close();
    toast('Account connected and checked.');
  }

  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    if (busy) return;
    fail('');
    const identifier = emailInput.value.trim().toLowerCase();
    busy = true;
    try {
      if (step === 'form') {
        waitText.textContent = 'Preparing the Google sign-in link…';
        show('waiting');
        const answer = await ask({ action: 'start', identifier, label: reconnect ? null : nameInput.value.trim() });
        if (answer.state !== 'done' || !answer.url) throw new Error(answer.message ?? 'Could not prepare the link.');
        link.href = answer.url;
        redirectInput.value = '';
        show('link');
        redirectInput.focus();
      } else if (step === 'link') {
        waitText.textContent = 'Connecting and checking the account…';
        show('waiting');
        const answer = await ask({ action: 'finish', identifier, redirect: redirectInput.value });
        if (answer.state !== 'done') throw new Error(answer.message ?? 'Could not connect.');
        waitText.textContent = `${answer.message ?? 'Connected.'} Updating the list…`;
        await refreshAfterConnect();
        return;
      }
    } catch (e) {
      fail((e as Error).message);
      // A Google code works once: after any failure start over from the first step (the address stays filled in).
      show('form');
    } finally {
      busy = false;
    }
  });

  dialog.addEventListener('close', () => {
    if (step === 'waiting') toast('Still working on the server. Check the list in a minute.', 'error');
  });
}
