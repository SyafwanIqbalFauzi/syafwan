// "Mark as checked" on /sejarahpersib: the row changes at once, the server is told, and the page content is
// fetched again in the background so the banner, the tab counts and the sidebar badge agree (no page reload).
import { toast } from './toast';
import { delegate, refresh } from './live';

export {};

/** What the owner expects to see the moment they press the button. The refresh afterwards confirms or undoes it. */
function showChecked(row: HTMLElement) {
  row.removeAttribute('data-attention');
  row.querySelector('.update-reason')?.remove();
  row.querySelectorAll('.tag-fail').forEach((tag) => {
    if (tag.textContent?.trim() === 'needs your check') tag.remove();
  });
  row.querySelector('[data-check-run]')?.remove();
  // Under "Show only these" a checked result leaves the list.
  if (new URLSearchParams(location.search).get('check') === '1') row.hidden = true;
}

delegate<HTMLButtonElement>('click', '[data-check-run]', async (button) => {
  const id = button.dataset.checkRun;
  if (!id || !/^\d+$/.test(id) || button.disabled) return;
  button.disabled = true;
  const row = button.closest<HTMLElement>('.update');
  if (row) showChecked(row);
  try {
    const res = await fetch(`/api/sejarahpersib/runs/${id}/check`, { method: 'POST', credentials: 'same-origin' });
    if (res.status === 401) {
      location.href = '/agent/login?next=/sejarahpersib';
      return;
    }
    if (!res.ok) {
      const data = await res.json().catch(() => null);
      throw new Error(data?.error ?? `Request failed (${res.status})`);
    }
    toast('Marked as checked.');
  } catch (error) {
    toast(error instanceof Error ? error.message : 'Could not mark it as checked', 'error');
  }
  // On success this confirms the new state; on failure it brings the row back as the server has it.
  await refresh();
});

// ------------------------------------------------------------------ follow-up modal
// "Follow up" opens a modal where the owner writes an instruction about one result. The server builds the
// prompt from the stored result and starts a Hermes run; the answer shows here and the chat link continues it.

const TERMINAL = new Set(['completed', 'failed', 'cancelled', 'interrupted']);
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

async function api(url: string, json?: unknown): Promise<{ status: number; data: any }> {
  const res = await fetch(url, {
    method: json === undefined ? 'GET' : 'POST',
    credentials: 'same-origin',
    headers: json === undefined ? undefined : { 'Content-Type': 'application/json' },
    body: json === undefined ? undefined : JSON.stringify(json),
  });
  if (res.status === 401) {
    location.href = '/agent/login?next=/sejarahpersib';
    throw new Error('Signed out');
  }
  return { status: res.status, data: await res.json().catch(() => null) };
}

const followDialog = document.getElementById('followup-dialog') as HTMLDialogElement | null;
if (followDialog) setupFollowup(followDialog);

function setupFollowup(dialog: HTMLDialogElement) {
  const form = dialog.querySelector<HTMLFormElement>('#followup-form')!;
  const instruction = form.elements.namedItem('instruction') as HTMLTextAreaElement;
  const context = dialog.querySelector<HTMLElement>('#followup-context')!;
  const statusEl = dialog.querySelector<HTMLElement>('#followup-status')!;
  const errorEl = dialog.querySelector<HTMLElement>('#followup-error')!;
  const answer = dialog.querySelector<HTMLElement>('#followup-answer')!;
  const chat = dialog.querySelector<HTMLAnchorElement>('#followup-chat')!;
  const sendBtn = dialog.querySelector<HTMLButtonElement>('#followup-send')!;
  const closeBtn = dialog.querySelector<HTMLButtonElement>('#followup-cancel')!;

  let runRow = '';
  let sent = false;
  /** Bumped on every send and close, so an old poll never writes into a newer session of the modal. */
  let ticket = 0;

  const showChat = (session: string) => {
    chat.href = `/agent/chat?session=${encodeURIComponent(session)}`;
    chat.hidden = false;
  };

  delegate<HTMLButtonElement>('click', '[data-followup-run]', (button) => {
    runRow = button.dataset.followupRun!;
    const reason = button.dataset.reason;
    context.textContent = [button.dataset.job, reason ? `Needs a look: ${reason}` : '', button.dataset.summary].filter(Boolean).join('\n');
    instruction.value = '';
    statusEl.textContent = '';
    errorEl.textContent = '';
    answer.hidden = true;
    answer.textContent = '';
    chat.hidden = true;
    sendBtn.disabled = false;
    sendBtn.hidden = false;
    sent = false;
    ticket += 1;
    if (button.dataset.session) showChat(button.dataset.session);
    dialog.showModal();
    instruction.focus();
  });

  closeBtn.addEventListener('click', () => dialog.close());
  dialog.addEventListener('close', () => {
    ticket += 1;
    // The row shows a "follow-up sent" tag once the content is read again.
    if (sent) void refresh();
  });

  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    if (sendBtn.disabled || !form.reportValidity()) return;
    const mine = ++ticket;
    errorEl.textContent = '';
    statusEl.textContent = 'Sending to Hermes…';
    sendBtn.disabled = true;
    try {
      const start = await api(`/api/sejarahpersib/runs/${runRow}/followup`, { instruction: instruction.value });
      if (start.status >= 400) throw new Error(start.data?.error ?? `Request failed (${start.status})`);
      sent = true;
      sendBtn.hidden = true;
      showChat(start.data.session_id);
      statusEl.textContent = 'Hermes is working on it…';
      answer.hidden = true;
      const until = Date.now() + 5 * 60_000;
      while (mine === ticket && Date.now() < until) {
        await sleep(2500);
        if (mine !== ticket) return;
        const { status, data } = await api(`/api/agent/runs/${encodeURIComponent(start.data.run_id)}`);
        if (status >= 400) throw new Error('Lost track of the run. Open the chat to see it.');
        if (data?.status && TERMINAL.has(data.status)) {
          if (data.status !== 'completed') throw new Error('The run did not finish. Open the chat to see why.');
          answer.textContent = String(data.output ?? '').trim() || '(no text)';
          answer.hidden = false;
          statusEl.textContent = 'Hermes answered. Reply or approve the plan in the chat.';
          return;
        }
      }
      if (mine === ticket) statusEl.textContent = 'Still working. Open the chat to follow it.';
    } catch (error) {
      if (mine !== ticket) return;
      statusEl.textContent = '';
      errorEl.textContent = error instanceof Error ? error.message : 'Could not send that';
      if (!sent) sendBtn.disabled = false;
    }
  });
}
