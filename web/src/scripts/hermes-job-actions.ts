// Run now / pause / resume / delete on an agent's detail page. All calls go through the
// allowlisted /api/agent/jobs/* proxy; the page content is fetched again afterwards to show the new state (no reload).

import { askConfirm } from './dialog';
import { delegate, refresh } from './live';
import { flash, toast } from './toast';

export {}; // makes this file a module so its top-level names stay local

// The box with the buttons is swapped after pause / resume, so it is looked up on every click.
delegate<HTMLButtonElement>('click', '[data-job] [data-job-action]', async (button) => {
  const box = button.closest<HTMLElement>('[data-job]')!;
  const statusEl = box.querySelector<HTMLElement>('[data-job-status]') ?? document.querySelector<HTMLElement>('[data-job-status]');
  const id = box.dataset.job!;
  const action = button.dataset.jobAction!;

  if (action === 'delete') {
    const sure = await askConfirm({
      title: 'Delete this agent?',
      message: `"${button.dataset.jobName ?? id}" stops running and is removed from Hermes. Its saved history stays on the website.`,
      confirm: 'Delete',
      danger: true,
    });
    if (!sure) return;
  }

  const buttons = box.querySelectorAll<HTMLButtonElement>('button');
  buttons.forEach((b) => (b.disabled = true));
  if (statusEl) statusEl.textContent = action === 'run' ? 'starting…' : 'working…';

  try {
    const res = await fetch(action === 'delete' ? `/api/agent/jobs/${id}` : `/api/agent/jobs/${id}/${action}`, {
      method: action === 'delete' ? 'DELETE' : 'POST',
      headers: action === 'delete' ? undefined : { 'Content-Type': 'application/json' },
      body: action === 'delete' ? undefined : '{}',
      credentials: 'same-origin',
    });
    if (res.status === 401) {
      location.href = '/agent/login';
      return;
    }
    if (!res.ok) {
      const data = await res.json().catch(() => null);
      throw new Error(data?.error?.message ?? data?.error ?? `Request failed (${res.status})`);
    }
    if (action === 'delete') {
      // The agent's page no longer exists: leave it for the list (a real navigation, with the message carried over).
      flash(`Agent “${button.dataset.jobName ?? id}” deleted`);
      location.href = '/agent/agents';
    } else if (action === 'run') {
      if (statusEl) statusEl.textContent = 'started: the result appears here within a few minutes';
      toast(`“${button.dataset.jobName ?? id}” is running. The result appears here within a few minutes.`, 'info', { title: 'Started' });
      buttons.forEach((b) => (b.disabled = false));
    } else {
      toast(`Agent “${button.dataset.jobName ?? id}” ${action === 'pause' ? 'paused' : 'resumed'}`);
      await refresh();
    }
  } catch (error) {
    if (statusEl) statusEl.textContent = (error as Error).message;
    toast((error as Error).message, 'error');
    buttons.forEach((b) => (b.disabled = false));
  }
});

// Group field on the detail page: saved through /api/agent/agents/<id>/group (Directus, not Hermes).
delegate<HTMLFormElement>('submit', '[data-group-form]', async (groupForm, event) => {
  event.preventDefault();
  const groupStatus = document.querySelector<HTMLElement>('[data-group-status]');
  const id = groupForm.dataset.job!;
  const value = (groupForm.elements.namedItem('group') as HTMLInputElement).value.trim();
  if (!value) {
    if (groupStatus) groupStatus.textContent = 'enter a group name';
    return;
  }
  if (groupStatus) groupStatus.textContent = 'saving…';
  try {
    const res = await fetch(`/api/agent/agents/${id}/group`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ group: value }),
      credentials: 'same-origin',
    });
    if (res.status === 401) {
      location.href = '/agent/login';
      return;
    }
    const data = await res.json().catch(() => null);
    if (!res.ok) throw new Error(data?.error ?? `Request failed (${res.status})`);
    if (groupStatus) groupStatus.textContent = `saved: ${data.group}`;
    toast(`Group set to “${data.group}”`);
  } catch (error) {
    if (groupStatus) groupStatus.textContent = (error as Error).message;
    toast((error as Error).message, 'error');
  }
});
