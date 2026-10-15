// Add a skill to an agent / remove it, from the skill's detail page. Goes through
// /api/hermes/skills/<name>/assign, which changes only the agent's skills list in Hermes.

export {}; // makes this file a module so its top-level names stay local
const list = document.querySelector<HTMLElement>('[data-skill]');
const attach = document.querySelector<HTMLFormElement>('[data-attach]');
const skill = (list ?? attach)?.dataset.skill;
const statusEl = attach?.querySelector<HTMLElement>('[data-assign-status]') ?? null;

async function assign(jobId: string, action: 'add' | 'remove'): Promise<void> {
  const res = await fetch(`/api/hermes/skills/${encodeURIComponent(skill!)}/assign`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ job_id: jobId, action }),
    credentials: 'same-origin',
  });
  if (res.status === 401) {
    location.href = '/hermes/login';
    return;
  }
  const data = await res.json().catch(() => null);
  if (!res.ok) throw new Error(data?.error ?? `Request failed (${res.status})`);
  location.reload();
}

list?.addEventListener('click', async (event) => {
  const button = (event.target as HTMLElement).closest<HTMLButtonElement>('[data-assign="remove"]');
  if (!button || !skill) return;
  const agent = button.dataset.jobName ?? 'this agent';
  if (!confirm(`Remove "${skill}" from "${agent}"?\n\nThe agent will no longer load this skill on its next run.`)) return;
  button.disabled = true;
  try {
    await assign(button.dataset.job!, 'remove');
  } catch (error) {
    button.disabled = false;
    alert((error as Error).message);
  }
});

attach?.addEventListener('submit', async (event) => {
  event.preventDefault();
  const select = attach.elements.namedItem('job') as HTMLSelectElement;
  if (!select.value || !skill) {
    if (statusEl) statusEl.textContent = 'choose an agent first';
    return;
  }
  const agent = select.selectedOptions[0]?.dataset.name ?? 'this agent';
  if (!confirm(`Add "${skill}" to "${agent}"?\n\nThis changes the live agent: it loads the skill from its next run.`)) return;
  const buttons = attach.querySelectorAll<HTMLButtonElement>('button');
  buttons.forEach((b) => (b.disabled = true));
  if (statusEl) statusEl.textContent = 'saving…';
  try {
    await assign(select.value, 'add');
  } catch (error) {
    if (statusEl) statusEl.textContent = (error as Error).message;
    buttons.forEach((b) => (b.disabled = false));
  }
});
