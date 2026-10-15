// Run now / pause / resume / delete on an agent's detail page. All calls go through the
// allowlisted /api/agent/jobs/* proxy; the page reloads afterwards to show the new state.

export {}; // makes this file a module so its top-level names stay local
const box = document.querySelector<HTMLElement>('[data-job]');
const statusEl = document.querySelector<HTMLElement>('[data-job-status]');

if (box) {
  const id = box.dataset.job!;
  box.addEventListener('click', async (event) => {
    const button = (event.target as HTMLElement).closest<HTMLButtonElement>('[data-job-action]');
    if (!button) return;
    const action = button.dataset.jobAction!;

    if (action === 'delete' && !confirm(`Delete "${button.dataset.jobName ?? id}"? Saved history stays on the website.`)) return;

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
      if (action === 'delete') location.href = '/agent/agents';
      else if (action === 'run' && statusEl) {
        statusEl.textContent = 'started: the result appears here within a few minutes';
        buttons.forEach((b) => (b.disabled = false));
      } else location.reload();
    } catch (error) {
      if (statusEl) statusEl.textContent = (error as Error).message;
      buttons.forEach((b) => (b.disabled = false));
    }
  });
}

// Group field on the detail page: saved through /api/agent/agents/<id>/group (Directus, not Hermes).
const groupForm = document.querySelector<HTMLFormElement>('[data-group-form]');
const groupStatus = document.querySelector<HTMLElement>('[data-group-status]');

groupForm?.addEventListener('submit', async (event) => {
  event.preventDefault();
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
  } catch (error) {
    if (groupStatus) groupStatus.textContent = (error as Error).message;
  }
});
