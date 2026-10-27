// /sejarahpersib/feedback: mark a message reviewed / not reviewed, and the "Reply by email" modal.
// The modal asks the agent for a draft (a Hermes run, watched by polling), lets the owner edit it, then
// sends it through the chosen connected account. Nothing is sent without the owner pressing "Send email".
import { parseSuggestion } from '../lib/feedback.ts';
import { askConfirm } from './dialog';
import { flash, toast } from './toast';

export {};

const SIGN_IN = '/agent/login?next=/sejarahpersib/feedback';
const TERMINAL = new Set(['completed', 'failed', 'cancelled', 'interrupted']);

async function call(url: string, init: RequestInit & { json?: unknown } = {}): Promise<{ status: number; data: any }> {
  const { json, ...rest } = init;
  const res = await fetch(url, {
    credentials: 'same-origin',
    ...rest,
    headers: json !== undefined ? { 'Content-Type': 'application/json' } : undefined,
    body: json !== undefined ? JSON.stringify(json) : undefined,
  });
  if (res.status === 401) {
    location.href = SIGN_IN;
    throw new Error('Signed out');
  }
  return { status: res.status, data: await res.json().catch(() => null) };
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

// ------------------------------------------------------------------ review

async function review(id: string, undo: boolean, button: HTMLButtonElement) {
  button.disabled = true;
  try {
    const { status, data } = await call(`/api/sejarahpersib/feedback/${id}/review`, { method: undo ? 'DELETE' : 'POST' });
    if (status >= 400) throw new Error(data?.error ?? `Request failed (${status})`);
    flash(undo ? 'Marked as not reviewed.' : 'Marked as reviewed.');
    location.reload();
  } catch (error) {
    button.disabled = false;
    toast(error instanceof Error ? error.message : 'Could not save that', 'error');
  }
}

document.querySelectorAll<HTMLButtonElement>('[data-review]').forEach((b) => b.addEventListener('click', () => review(b.dataset.review!, false, b)));
document.querySelectorAll<HTMLButtonElement>('[data-unreview]').forEach((b) => b.addEventListener('click', () => review(b.dataset.unreview!, true, b)));

// ------------------------------------------------------------------ reply modal

const dialog = document.getElementById('reply-dialog') as HTMLDialogElement | null;
if (dialog) setupReply(dialog);

function setupReply(dialog: HTMLDialogElement) {
  const form = dialog.querySelector<HTMLFormElement>('#reply-form')!;
  const from = form.elements.namedItem('from') as HTMLSelectElement;
  const to = form.elements.namedItem('to') as HTMLInputElement;
  const subject = form.elements.namedItem('subject') as HTMLInputElement;
  const body = form.elements.namedItem('body') as HTMLTextAreaElement;
  const original = dialog.querySelector<HTMLElement>('#reply-original')!;
  const statusEl = dialog.querySelector<HTMLElement>('#reply-status')!;
  const errorEl = dialog.querySelector<HTMLElement>('#reply-error')!;
  const sendBtn = dialog.querySelector<HTMLButtonElement>('#reply-send')!;
  const redraftBtn = dialog.querySelector<HTMLButtonElement>('#reply-redraft')!;
  const cancelBtn = dialog.querySelector<HTMLButtonElement>('#reply-cancel')!;

  let feedbackId = '';
  let alreadyReplied = false;
  let busy = false;
  /** Bumped on every draft / close, so an old draft that finishes late never overwrites newer text. */
  let ticket = 0;

  const say = (text: string) => (statusEl.textContent = text);
  const fail = (text: string) => (errorEl.textContent = text);
  function setBusy(value: boolean) {
    busy = value;
    sendBtn.disabled = value;
    redraftBtn.disabled = value;
    cancelBtn.disabled = value && sendBtn.dataset.sending === 'true';
  }

  async function draft() {
    const mine = ++ticket;
    fail('');
    say('Drafting a reply…');
    redraftBtn.disabled = true;
    sendBtn.disabled = true;
    try {
      const start = await call(`/api/sejarahpersib/feedback/${feedbackId}/suggest`, { method: 'POST' });
      if (start.status >= 400) throw new Error(start.data?.error ?? 'Could not ask for a draft');
      const runId: string = start.data.run_id;
      const until = Date.now() + 150_000;
      while (mine === ticket && Date.now() < until) {
        await sleep(2500);
        if (mine !== ticket) return;
        const { status, data } = await call(`/api/agent/runs/${encodeURIComponent(runId)}`);
        if (status >= 400) throw new Error('Lost track of the draft');
        if (data?.status && TERMINAL.has(data.status)) {
          if (data.status !== 'completed') throw new Error('The draft did not finish');
          const parsed = parseSuggestion(String(data.output ?? ''));
          if (!parsed) throw new Error('The draft came back in an unexpected shape. Write the reply yourself or try again.');
          if (!subject.value.trim()) subject.value = parsed.subject;
          if (!body.value.trim() || body.dataset.draft === 'true') {
            body.value = parsed.body;
            body.dataset.draft = 'true';
          }
          say('Draft ready. Check and edit it before sending.');
          return;
        }
      }
      if (mine === ticket) throw new Error('The draft is taking too long. Write the reply yourself or try again.');
    } catch (error) {
      if (mine === ticket) {
        say('');
        fail(error instanceof Error ? error.message : 'Could not draft a reply');
      }
    } finally {
      if (mine === ticket) {
        redraftBtn.disabled = false;
        sendBtn.disabled = false;
      }
    }
  }

  document.querySelectorAll<HTMLButtonElement>('[data-reply]').forEach((button) => {
    button.addEventListener('click', () => {
      const card = button.closest<HTMLElement>('[data-feedback]');
      if (!card) return;
      feedbackId = card.dataset.feedback!;
      alreadyReplied = button.dataset.replied === 'true';
      to.value = card.dataset.email ?? '';
      original.textContent = `${card.dataset.name || 'Anonymous'}: ${card.querySelector('.feedback-message')?.textContent ?? ''}`;
      subject.value = '';
      body.value = '';
      delete body.dataset.draft;
      fail('');
      delete sendBtn.dataset.sending;
      setBusy(false);
      dialog.showModal();
      void draft();
    });
  });

  body.addEventListener('input', () => delete body.dataset.draft);
  redraftBtn.addEventListener('click', () => {
    body.dataset.draft = 'true';
    void draft();
  });
  cancelBtn.addEventListener('click', () => dialog.close());
  dialog.addEventListener('close', () => {
    ticket += 1;
  });
  // Escape would drop a half-written reply and, mid-send, hide the outcome: block it while sending.
  dialog.addEventListener('cancel', (event) => {
    if (sendBtn.dataset.sending === 'true') event.preventDefault();
  });

  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    if (busy) return;
    fail('');
    if (!form.reportValidity()) return;
    const payload = { from: from.value, subject: subject.value, body: body.value, resend: alreadyReplied };
    const ok = await askConfirm({
      title: alreadyReplied ? 'Send another reply?' : 'Send this email?',
      message: `From ${from.value}\nTo ${to.value}\n\nAn email cannot be taken back once it is sent.`,
      confirm: 'Send',
    });
    if (!ok) return;

    ticket += 1; // a draft still running must not touch the text any more
    sendBtn.dataset.sending = 'true';
    setBusy(true);
    say('Sending through the agent… this can take up to a minute.');
    try {
      let result = await call(`/api/sejarahpersib/feedback/${feedbackId}/reply`, { method: 'POST', json: payload });
      let tries = 0;
      while (result.data?.state === 'pending' && tries++ < 20) {
        result = await call(`/api/sejarahpersib/feedback/${feedbackId}/reply-done`, { method: 'POST', json: { ...payload, run_id: result.data.run_id } });
      }
      if (result.data?.state === 'sent') {
        flash('Email sent and saved with the message.');
        location.reload();
        return;
      }
      if (result.data?.state === 'pending') throw new Error('The agent is still sending. Check the sent folder before trying again.');
      throw new Error(result.data?.error ?? `Request failed (${result.status})`);
    } catch (error) {
      say('');
      fail(error instanceof Error ? error.message : 'Could not send the email');
      delete sendBtn.dataset.sending;
      setBusy(false);
    }
  });
}
