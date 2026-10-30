// Add a skill to an agent / remove it, from the skill's detail page. Goes through
// /api/agent/skills/<name>/assign, which changes only the agent's skills list in Hermes.

import { askConfirm, askNotice } from './dialog';
import { delegate, refresh } from './live';
import { toast } from './toast';

export {}; // makes this file a module so its top-level names stay local
// The lists on this page are swapped after every change, so they are looked up when used.
const skillName = () => document.querySelector<HTMLElement>('[data-skill]')?.dataset.skill;

async function assign(jobId: string, action: 'add' | 'remove', done: string): Promise<void> {
  const res = await fetch(`/api/agent/skills/${encodeURIComponent(skillName()!)}/assign`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ job_id: jobId, action }),
    credentials: 'same-origin',
  });
  if (res.status === 401) {
    location.href = '/agent/login';
    return;
  }
  const data = await res.json().catch(() => null);
  if (!res.ok) throw new Error(data?.error ?? `Request failed (${res.status})`);
  toast(done);
  await refresh();
}

delegate<HTMLButtonElement>('click', '[data-assign="remove"]', async (button) => {
  const skill = skillName();
  if (!skill) return;
  const agent = button.dataset.jobName ?? 'this agent';
  const sure = await askConfirm({ title: 'Remove this skill?', message: `"${skill}" is removed from "${agent}".\n\nThe agent will no longer load it on its next run.`, confirm: 'Remove', danger: true });
  if (!sure) return;
  button.disabled = true;
  try {
    await assign(button.dataset.job!, 'remove', `Skill “${skill}” removed from “${agent}”`);
  } catch (error) {
    button.disabled = false;
    toast((error as Error).message, 'error');
    await askNotice({ title: 'Could not remove the skill', message: (error as Error).message });
  }
});

delegate<HTMLFormElement>('submit', '[data-attach]', async (attach, event) => {
  event.preventDefault();
  const skill = attach.dataset.skill;
  const statusEl = attach.querySelector<HTMLElement>('[data-assign-status]');
  const select = attach.elements.namedItem('job') as HTMLSelectElement;
  if (!select.value || !skill) {
    if (statusEl) statusEl.textContent = 'choose an agent first';
    return;
  }
  const agent = select.selectedOptions[0]?.dataset.name ?? 'this agent';
  const sure = await askConfirm({ title: 'Add this skill?', message: `"${skill}" is added to "${agent}".\n\nThis changes the live agent: it loads the skill from its next run.`, confirm: 'Add' });
  if (!sure) return;
  const buttons = attach.querySelectorAll<HTMLButtonElement>('button');
  buttons.forEach((b) => (b.disabled = true));
  if (statusEl) statusEl.textContent = 'saving…';
  try {
    await assign(select.value, 'add', `Skill “${skill}” added to “${agent}”`);
  } catch (error) {
    if (statusEl) statusEl.textContent = (error as Error).message;
    toast((error as Error).message, 'error');
    buttons.forEach((b) => (b.disabled = false));
  }
});
