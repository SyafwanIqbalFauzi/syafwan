// Enable/disable a skill and edit its instructions. Neither touches Hermes directly: the page
// records a request, then waits while the VPS applies it (usually within a minute) and reports
// what happened. See pages/api/agent/skills/[name]/{enabled,content}.ts and apply_skill_changes.py.
export {};

const banner = document.querySelector<HTMLElement>('[data-change-banner]');
const toggle = document.querySelector<HTMLButtonElement>('[data-toggle]');
const editor = document.querySelector<HTMLFormElement>('[data-editor]');
const POLL_MS = 3000;
const GIVE_UP_MS = 150_000;

const say = (text: string, error = false) => {
  if (!banner) return;
  banner.hidden = !text;
  banner.textContent = text;
  banner.classList.toggle('error', error);
};

async function post(url: string, body: unknown): Promise<{ id?: number; unchanged?: boolean }> {
  const res = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body), credentials: 'same-origin' });
  if (res.status === 401) {
    location.href = '/agent/login';
    throw new Error('signed out');
  }
  const data = await res.json().catch(() => null);
  if (!res.ok) throw new Error(data?.error ?? `Request failed (${res.status})`);
  return data;
}

/** Poll until the VPS has dealt with the request. Resolves to the final message; throws if it was not applied. */
async function waitForApply(id: number): Promise<string> {
  const started = Date.now();
  say('Sent. Waiting for Hermes to apply it (a few seconds, up to two minutes)…');
  while (Date.now() - started < GIVE_UP_MS) {
    await new Promise((r) => setTimeout(r, POLL_MS));
    const res = await fetch(`/api/agent/skill-changes/${id}`, { credentials: 'same-origin' });
    if (res.status === 401) {
      location.href = '/agent/login';
      throw new Error('signed out');
    }
    const row = await res.json().catch(() => null);
    if (!row || row.status === 'pending') continue;
    if (row.status === 'applied') return row.result ?? 'Applied.';
    throw new Error(row.result ?? 'The change was not applied.');
  }
  throw new Error('Hermes has not applied the change yet. It stays queued for up to 15 minutes; check "Recent changes" below.');
}

async function run(button: HTMLElement | null, work: () => Promise<number | null>): Promise<void> {
  const controls = [...document.querySelectorAll<HTMLButtonElement>('[data-toggle], [data-editor] button')];
  controls.forEach((c) => (c.disabled = true));
  try {
    const id = await work();
    if (id === null) {
      location.reload();
      return;
    }
    const result = await waitForApply(id);
    say(result);
    setTimeout(() => location.reload(), 1200);
  } catch (error) {
    say((error as Error).message, true);
    controls.forEach((c) => (c.disabled = false));
  }
  void button;
}

toggle?.addEventListener('click', () => {
  const skill = toggle.dataset.skill!;
  const enable = toggle.dataset.enabled === 'false';
  const users = JSON.parse(toggle.dataset.users ?? '[]') as string[];
  const lines = enable
    ? [`Enable "${skill}"?`]
    : [
        `Disable "${skill}"?`,
        users.length ? `\n${users.length} agent${users.length === 1 ? '' : 's'} use it. They will still run, but WITHOUT this skill's instructions (Hermes skips it), which can change what they produce:\n  -${users.slice(0, 8).join('\n  - ')}${users.length > 8 ? `\n  …and ${users.length - 8} more` : ''}` : '',
      ];
  if (!confirm(lines.filter(Boolean).join('\n'))) return;
  void run(toggle, async () => {
    const res = await post(`/api/agent/skills/${encodeURIComponent(skill)}/enabled`, { enabled: enable });
    return res.unchanged ? null : (res.id ?? null);
  });
});

editor?.addEventListener('submit', (event) => {
  event.preventDefault();
  const area = editor.elements.namedItem('content') as HTMLTextAreaElement;
  if (area.value === area.defaultValue) {
    say('Nothing changed.');
    return;
  }
  if (!confirm('Save these changes to the skill?\n\nAgents that use it follow the new instructions from their next run. The previous version is kept as a backup on the server.')) return;
  void run(null, async () => {
    const res = await post(`/api/agent/skills/${encodeURIComponent(editor.dataset.skill!)}/content`, { content: area.value, base_hash: editor.dataset.baseHash });
    return res.id ?? null;
  });
});

editor?.querySelector('[data-undo]')?.addEventListener('click', () => {
  const area = editor.elements.namedItem('content') as HTMLTextAreaElement;
  area.value = area.defaultValue;
  say('');
});

// Warn before leaving the page with unsaved edits.
window.addEventListener('beforeunload', (event) => {
  const area = editor?.elements.namedItem('content') as HTMLTextAreaElement | undefined;
  if (area && area.value !== area.defaultValue && !area.disabled) event.preventDefault();
});
