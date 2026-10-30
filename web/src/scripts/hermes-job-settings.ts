// Edit name and schedule on an agent's detail page. The form speaks WIB and friendly modes;
// schedule-edit.ts turns it into what Hermes stores, and the preview shows the result before saving.
import { askConfirm } from './dialog';
import { mountLive, refresh } from './live';
import { toast } from './toast';
import { humanizeSchedule } from '../lib/schedule';
import { buildSchedule, type ScheduleForm, type ScheduleMode } from '../lib/schedule-edit';

// The form is drawn again after a save (with the new values), so it is set up each time it appears.
mountLive((root) => {
  const form = root.querySelector<HTMLFormElement>('[data-settings-form]');
  if (!form) return;
  const id = form.dataset.job!;
  const currentName = form.dataset.currentName ?? '';
  const currentSchedule = form.dataset.currentSchedule ?? '';
  const initial = JSON.parse(form.dataset.initial ?? '{}') as ScheduleForm & { name: string };

  const field = <T extends HTMLElement>(name: string) => form.elements.namedItem(name) as unknown as T;
  const mode = field<HTMLSelectElement>('mode');
  const preview = form.querySelector<HTMLElement>('[data-preview]')!;
  const statusEl = form.querySelector<HTMLElement>('[data-settings-status]')!;
  const groups = [...form.querySelectorAll<HTMLElement>('[data-for]')];

  const read = (): ScheduleForm => ({
    mode: mode.value as ScheduleMode,
    minutes: Number(field<HTMLInputElement>('minutes').value),
    minute: Number(field<HTMLInputElement>('minute').value),
    time: field<HTMLInputElement>('time').value,
    weekday: Number(field<HTMLSelectElement>('weekday').value),
    raw: field<HTMLInputElement>('raw').value,
  });

  const fill = (values: ScheduleForm & { name?: string }) => {
    if (values.name !== undefined) field<HTMLInputElement>('name').value = values.name;
    mode.value = values.mode;
    field<HTMLInputElement>('minutes').value = String(values.minutes ?? 30);
    field<HTMLInputElement>('minute').value = String(values.minute ?? 0);
    field<HTMLInputElement>('time').value = values.time ?? '07:00';
    field<HTMLSelectElement>('weekday').value = String(values.weekday ?? 1);
    field<HTMLInputElement>('raw').value = values.raw ?? '';
  };

  const refresh = () => {
    for (const g of groups) g.hidden = !(g.dataset.for ?? '').split(' ').includes(mode.value);
    const built = buildSchedule(read());
    preview.classList.toggle('bad', built === null);
    preview.textContent = built === null ? 'That schedule is not valid yet.' : `${humanizeSchedule(built)}  ·  stored as "${built}"`;
    return built;
  };

  // Switching to "custom" starts from the current expression so it can be tweaked.
  mode.addEventListener('change', () => {
    if (mode.value === 'custom' && !field<HTMLInputElement>('raw').value) field<HTMLInputElement>('raw').value = buildSchedule(initial) ?? currentSchedule;
    refresh();
  });
  form.addEventListener('input', refresh);
  form.querySelector('[data-reset]')?.addEventListener('click', () => {
    fill(initial);
    statusEl.textContent = '';
    refresh();
  });

  fill(initial);
  refresh();

  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    const name = field<HTMLInputElement>('name').value.replace(/\s+/g, ' ').trim();
    const schedule = buildSchedule(read());
    if (!name) return void (statusEl.textContent = 'enter a name');
    if (schedule === null) return void (statusEl.textContent = 'fix the schedule first');

    const body: { name?: string; schedule?: string } = {};
    if (name !== currentName) body.name = name;
    if (schedule !== currentSchedule) body.schedule = schedule;
    if (!body.name && !body.schedule) return void (statusEl.textContent = 'nothing changed');

    const changes = [
      body.name ? `Name: "${currentName}" → "${body.name}"` : '',
      body.schedule ? `Runs: ${humanizeSchedule(currentSchedule)} → ${humanizeSchedule(body.schedule)}` : '',
    ].filter(Boolean);
    const sure = await askConfirm({ title: 'Save these changes?', message: `${changes.join('\n')}\n\nThis changes the live agent.`, confirm: 'Save' });
    if (!sure) return;

    const buttons = form.querySelectorAll<HTMLButtonElement>('button');
    buttons.forEach((b) => (b.disabled = true));
    statusEl.textContent = 'saving…';
    try {
      const res = await fetch(`/api/agent/agents/${id}/settings`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
        credentials: 'same-origin',
      });
      if (res.status === 401) {
        location.href = '/agent/login';
        return;
      }
      const data = await res.json().catch(() => null);
      if (!res.ok) throw new Error(data?.error ?? `Request failed (${res.status})`);
      statusEl.textContent = 'saved';
      toast(body.name && body.schedule ? 'Agent name and schedule updated' : body.name ? 'Agent name updated' : 'Agent schedule updated');
      await refresh();
    } catch (error) {
      statusEl.textContent = (error as Error).message;
      toast((error as Error).message, 'error');
      buttons.forEach((b) => (b.disabled = false));
    }
  });
});
