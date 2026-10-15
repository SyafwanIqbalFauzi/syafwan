// Browser side of /agent/chat: session list, a chat turn as a server-side run (watch/re-attach), tool cards, approvals, stop.
// Everything goes through /api/agent/* (see src/pages/api/agent/[...path].ts).
import { describeActivity, isWaitingForPerson, nextActivity, type Activity } from '../lib/chat-activity';
import { normalizeTitle, titleFromMessage } from '../lib/chat-title';
import { askConfirm, askText } from './dialog';
import { clearActiveRun, loadActiveRun, saveActiveRun, watchRun, type ActiveRun, type RunEvent } from '../lib/chat-run';

const $ = <T extends HTMLElement>(sel: string) => document.querySelector(sel) as T;
const sessionsEl = $<HTMLUListElement>('#sessions');
const logEl = $<HTMLDivElement>('#log');
const titleEl = $<HTMLElement>('#title');
const renameBtn = $<HTMLButtonElement>('#rename-title');
const form = $<HTMLFormElement>('#composer');
const input = $<HTMLTextAreaElement>('#input');
const sendBtn = $<HTMLButtonElement>('#send');
const stopBtn = $<HTMLButtonElement>('#stop');
const newBtn = $<HTMLButtonElement>('#new-chat');
const statusEl = $<HTMLElement>('#status');

let sessionId: string | null = null;
let runId: string | null = null;
let controller: AbortController | null = null;

// ---- helpers -------------------------------------------------------------

async function api(path: string, init: RequestInit = {}): Promise<any> {
  const res = await fetch(`/api/agent/${path}`, {
    ...init,
    headers: init.body ? { 'Content-Type': 'application/json' } : undefined,
    credentials: 'same-origin',
  });
  if (res.status === 401) {
    location.href = '/agent/login';
    throw new Error('signed out');
  }
  const data = await res.json().catch(() => null);
  if (!res.ok) throw new Error(data?.error?.message ?? data?.error ?? `Request failed (${res.status})`);
  return data;
}

const asList = (d: any, key: string): any[] => (Array.isArray(d) ? d : (d?.[key] ?? d?.data ?? d?.items ?? []));
const idOf = (s: any): string | null => s?.id ?? s?.session_id ?? null;
const textOf = (content: unknown): string =>
  typeof content === 'string'
    ? content
    : Array.isArray(content)
      ? content.map((p: any) => (typeof p === 'string' ? p : (p?.text ?? ''))).join('')
      : '';

function el<K extends keyof HTMLElementTagNameMap>(tag: K, cls = '', text = ''): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (cls) node.className = cls;
  if (text) node.textContent = text;
  return node;
}

const scrollDown = () => logEl.scrollTo({ top: logEl.scrollHeight });
const setStatus = (text: string) => (statusEl.textContent = text);

function setBusy(busy: boolean) {
  sendBtn.hidden = busy;
  stopBtn.hidden = !busy;
  input.disabled = busy;
  if (!busy) input.focus();
}

// ---- "Hermes is working" indicator ----------------------------------------
// A line at the end of the conversation that says what Hermes is doing right now (thinking,
// writing, using a tool, waiting for approval) with a timer, driven by the stream's own events.
const baseTitle = document.title;
let indicator: HTMLElement | null = null;
let indicatorText: HTMLElement | null = null;
let indicatorTime: HTMLElement | null = null;
let activity: Activity = { phase: 'thinking' };
let activityTimer: ReturnType<typeof setInterval> | undefined;
let turnStartedAt = 0;
let lastEventAt = 0;

function paintActivity() {
  if (!indicator || !indicatorText || !indicatorTime) return;
  const now = Date.now();
  indicatorText.textContent = describeActivity(activity, (now - lastEventAt) / 1000);
  indicatorTime.textContent = `${Math.floor((now - turnStartedAt) / 1000)} s`;
  indicator.classList.toggle('wait', isWaitingForPerson(activity));
  document.title = `${isWaitingForPerson(activity) ? '❓' : '●'} ${baseTitle}`;
}

function keepIndicatorLast() {
  if (indicator && logEl.lastElementChild !== indicator) logEl.append(indicator);
}

function startActivity() {
  stopActivity();
  activity = { phase: 'thinking' };
  turnStartedAt = lastEventAt = Date.now();
  indicator = el('div', 'typing');
  indicator.setAttribute('role', 'status');
  const dots = el('span', 'dots');
  dots.setAttribute('aria-hidden', 'true');
  dots.append(el('i'), el('i'), el('i'));
  indicatorText = el('span', 'typing-text');
  indicatorTime = el('span', 'typing-time');
  indicator.append(dots, indicatorText, indicatorTime);
  logEl.append(indicator);
  logEl.setAttribute('aria-busy', 'true');
  paintActivity();
  activityTimer = setInterval(paintActivity, 1000);
}

function onActivityEvent(name: string, data: Record<string, any> = {}) {
  activity = nextActivity(activity, name, data);
  lastEventAt = Date.now();
  paintActivity();
}

function stopActivity() {
  clearInterval(activityTimer);
  indicator?.remove();
  indicator = indicatorText = indicatorTime = null;
  logEl.removeAttribute('aria-busy');
  document.title = baseTitle;
}

// ---- sessions ------------------------------------------------------------

async function loadSessions() {
  try {
    // The sidebar lists real conversations only: cron runs would otherwise bury them
    // (Hermes keeps one session per scheduled run).
    const SOURCES: Record<string, string> = { api_server: 'web', telegram: 'telegram', discord: 'discord' };
    const lists = await Promise.all(Object.keys(SOURCES).map((source) => api(`sessions?limit=25&source=${source}`).catch(() => null)));
    const data = lists
      .flatMap((d) => (d ? asList(d, 'sessions') : []))
      .filter((s) => (s.message_count ?? 1) > 0 || idOf(s) === sessionId)
      .sort((a, b) => (b.last_active ?? b.started_at ?? 0) - (a.last_active ?? a.started_at ?? 0))
      .slice(0, 50);
    sessionsEl.replaceChildren(
      ...data.map((s) => {
        const id = idOf(s);
        const li = el('li', id === sessionId ? 'active' : '');
        const badge = SOURCES[s.source] && s.source !== 'api_server' ? `[${SOURCES[s.source]}] ` : '';
        const open = el('button', 'open', badge + (s.title || s.preview || id || 'untitled'));
        open.addEventListener('click', () => id && openSession(id, s.title || s.preview || 'Chat'));
        const label = s.title || s.preview || id || 'untitled';
        const rename = el('button', 'mini', 'rename');
        rename.addEventListener('click', () => id && renameSession(id, s.title ?? label));
        const del = el('button', 'mini', 'delete');
        del.addEventListener('click', async () => {
          if (!id) return;
          const yes = await askConfirm({
            title: 'Delete this chat?',
            message: `"${label}" is removed from Hermes for good. This cannot be undone.`,
            confirm: 'Delete',
            danger: true,
          });
          if (!yes) return;
          await api(`sessions/${id}`, { method: 'DELETE' }).catch((e) => setStatus(e.message));
          if (id === sessionId) newChat();
          loadSessions();
        });
        li.append(open, rename, del);
        return li;
      }),
    );
  } catch (e) {
    setStatus((e as Error).message);
  }
}

// ---- renaming ---------------------------------------------------------------
// Two ways in: click the title above the conversation (edited in place), or "rename" in the sidebar
// (a dialog). Both save with PATCH /sessions/<id> and refresh the sidebar.
let titleEditing = false;

function syncTitleControls() {
  const can = Boolean(sessionId);
  renameBtn.hidden = !can;
  titleEl.dataset.editable = String(can);
  titleEl.tabIndex = can ? 0 : -1;
}

async function saveTitle(id: string, raw: string): Promise<string | null> {
  const title = normalizeTitle(raw);
  if (!title) {
    setStatus('A title needs 1–120 characters, on one line.');
    return null;
  }
  try {
    await api(`sessions/${id}`, { method: 'PATCH', body: JSON.stringify({ title }) });
    loadSessions();
    return title;
  } catch (e) {
    setStatus((e as Error).message);
    return null;
  }
}

async function renameSession(id: string, current: string) {
  const value = await askText({
    title: 'Rename chat',
    label: 'Title',
    value: current,
    maxLength: 120,
    confirm: 'Save',
    validate: (v) => (normalizeTitle(v) ? null : 'Enter 1–120 characters on one line.'),
  });
  if (value === null) return;
  const saved = await saveTitle(id, value);
  if (saved && id === sessionId) titleEl.textContent = saved;
}

function beginTitleEdit() {
  if (!sessionId || titleEditing) return;
  const id = sessionId;
  const before = titleEl.textContent ?? '';
  titleEditing = true;
  const field = el('input', 'title-input');
  field.value = before;
  field.maxLength = 120;
  field.setAttribute('aria-label', 'Chat title');
  titleEl.replaceChildren(field);
  field.focus();
  field.select();

  let finished = false;
  const finish = async (save: boolean) => {
    if (finished) return;
    finished = true;
    titleEditing = false;
    const next = field.value.trim();
    titleEl.textContent = before;
    if (save && next && next !== before) {
      const saved = await saveTitle(id, next);
      if (saved && id === sessionId) titleEl.textContent = saved;
    }
  };
  field.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      void finish(true);
    } else if (e.key === 'Escape') {
      e.preventDefault();
      void finish(false);
    }
  });
  field.addEventListener('blur', () => void finish(true));
}

function newChat() {
  detachFromRun(); // a run in progress keeps going in the background
  sessionId = null;
  runId = null;
  syncTitleControls();
  titleEl.textContent = 'New chat';
  logEl.replaceChildren(el('p', 'hint', 'Ask Hermes anything. It can run commands on the server, so approvals will appear here.'));
  input.focus();
}

async function openSession(id: string, title: string, opts: { skipResume?: boolean } = {}) {
  detachFromRun(); // a run in progress elsewhere keeps going; we just stop watching it from here
  sessionId = id;
  syncTitleControls();
  titleEl.textContent = title;
  logEl.replaceChildren(el('p', 'hint', 'Loading…'));
  if (title === 'Session' || title === 'Chat') {
    // Opened by id only (a link, or after a reload): look the real title up.
    void api(`sessions/${id}`)
      .then((meta) => {
        const real = meta?.title ?? meta?.session?.title ?? meta?.preview ?? meta?.session?.preview;
        if (real && id === sessionId && !titleEditing) titleEl.textContent = String(real);
      })
      .catch(() => {});
  }
  try {
    const messages = asList(await api(`sessions/${id}/messages`), 'messages');
    logEl.replaceChildren();
    for (const m of messages) {
      if (m.role !== 'user' && m.role !== 'assistant') continue;
      const text = textOf(m.content);
      if (!text.trim()) continue;
      const bubble = addBubble(m.role);
      if (m.role === 'assistant' && typeof m.html === 'string') bubble.innerHTML = m.html;
      else bubble.textContent = text;
    }
    if (!logEl.children.length) logEl.append(el('p', 'hint', 'Empty session.'));
    scrollDown();
  } catch (e) {
    logEl.replaceChildren(el('p', 'hint', (e as Error).message));
  }
  loadSessions();
  if (!opts.skipResume && id === sessionId) await resumeIfRunning(id);
}

function addBubble(role: 'user' | 'assistant'): HTMLDivElement {
  const wrap = el('div', `msg ${role}`);
  const body = el('div', 'body');
  wrap.append(body);
  logEl.append(wrap);
  return body;
}

// ---- chat turn -----------------------------------------------------------

// A chat turn is a *run* on the server. Sending starts it; the page only watches. If the page is
// closed, reloaded or left, the run carries on (and keeps waiting if it needs an approval); coming
// back to the conversation re-attaches and replays what was missed. See lib/chat-run.ts.

interface Turn {
  reply: HTMLElement;
  streamed: string;
  toolCards: HTMLElement[];
}

function beginTurn(message: string, showUserBubble: boolean): Turn {
  logEl.querySelector('.hint')?.remove();
  if (showUserBubble) addBubble('user').textContent = message;
  const reply = addBubble('assistant');
  reply.classList.add('streaming');
  return { reply, streamed: '', toolCards: [] };
}

/** Stop watching the current run in this page (the run itself is not touched). */
function detachFromRun() {
  controller?.abort();
  controller = null;
  stopActivity();
  setBusy(false);
}

function applyRunEvent(ev: RunEvent, turn: Turn) {
  const data = ev.data;
  onActivityEvent(ev.name, data);

  switch (ev.name) {
    case 'message.delta':
      turn.streamed += data.delta ?? '';
      turn.reply.textContent = turn.streamed;
      break;
    case 'tool.started': {
      const card = el('div', 'tool running');
      card.append(el('strong', '', data.tool ?? 'tool'), el('span', '', ` ${data.preview ?? ''}`.slice(0, 200)));
      logEl.insertBefore(card, turn.reply.parentElement);
      turn.toolCards.push(card);
      break;
    }
    case 'tool.completed': {
      const card = turn.toolCards.find((c) => c.classList.contains('running') && c.firstElementChild?.textContent === data.tool);
      card?.classList.remove('running');
      if (data.error) card?.classList.add('failed');
      break;
    }
    case 'approval.request':
      showApproval(data);
      break;
    case 'approval.responded':
      // Answered (here or from another tab): make sure no stale buttons are left.
      logEl.querySelectorAll('.approval .choices').forEach((row) => row.replaceWith(el('p', 'hint', `Answered: ${String(data.choice ?? 'done')}.`)));
      break;
    case 'replay.truncated':
      logEl.insertBefore(el('p', 'hint', 'Part of the live view was no longer available; the full answer appears when Hermes finishes.'), turn.reply.parentElement);
      break;
    case 'run.completed':
      if (typeof data.output === 'string' && data.output) {
        turn.streamed = data.output;
        turn.reply.textContent = turn.streamed;
      }
      break;
    case 'run.failed':
      turn.reply.classList.add('error');
      turn.reply.textContent = String(data.error ?? 'Hermes could not finish this message.');
      break;
    case 'run.cancelled':
    case 'run.interrupted':
      if (!turn.streamed) turn.reply.parentElement?.append(el('p', 'hint', 'Stopped.'));
      break;
  }
  keepIndicatorLast();
  scrollDown();
}

/** Watch `run` until it ends, painting into `turn`. Safe to call again for the same run. */
async function followRun(run: ActiveRun, turn: Turn) {
  detachFromRun();
  const mine = new AbortController();
  controller = mine;
  runId = run.runId;
  setBusy(true);
  setStatus('');
  startActivity();
  scrollDown();

  const result = await watchRun({
    fetchImpl: fetch,
    runId: run.runId,
    lastSeq: run.lastSeq,
    signal: mine.signal,
    onProgress: (seq) => {
      run.lastSeq = seq;
      saveActiveRun(localStorage, run);
    },
    onEvent: (ev) => applyRunEvent(ev, turn),
  });

  if (controller !== mine) return; // another conversation took over while we were watching
  controller = null;
  stopActivity();
  turn.reply.classList.remove('streaming');
  setBusy(false);

  if (result === 'signed-out') {
    location.href = '/agent/login';
    return;
  }
  if (result === 'aborted') return;
  clearActiveRun(localStorage);
  runId = null;
  if (result === 'lost') {
    // The server no longer has the live view of this run; whatever Hermes saved is in the conversation.
    setStatus('Lost the live view of this message. Showing what Hermes saved…');
    await openSession(run.sessionId, titleEl.textContent || 'Chat', { skipResume: true });
  } else {
    await renderFinal(turn.reply, turn.streamed);
  }
  loadSessions();
}

async function send(message: string) {
  if (!sessionId) {
    const created = await api('sessions', { method: 'POST', body: '{}' });
    sessionId = idOf(created?.session ?? created);
    if (!sessionId) throw new Error('Could not create a session');
    titleEl.textContent = titleFromMessage(message);
    syncTitleControls();
  }
  const turn = beginTurn(message, true);
  setBusy(true);
  setStatus('');
  try {
    const started = await api('runs', { method: 'POST', body: JSON.stringify({ input: message, session_id: sessionId }) });
    const run: ActiveRun = { runId: started.run_id, sessionId, message, lastSeq: -1, startedAt: Date.now() };
    saveActiveRun(localStorage, run);
    void followRun(run, turn);
  } catch (e) {
    turn.reply.classList.remove('streaming');
    turn.reply.classList.add('error');
    turn.reply.textContent = (e as Error).message;
    setBusy(false);
  }
}

/** If this conversation has a run in progress (started here earlier, or before a reload), watch it again. */
async function resumeIfRunning(id: string) {
  const active = loadActiveRun(localStorage);
  if (!active || active.sessionId !== id || controller) return;

  const res = await fetch(`/api/agent/runs/${encodeURIComponent(active.runId)}`, { credentials: 'same-origin' }).catch(() => null);
  if (!res) return; // offline: try again next time
  if (res.status === 401) {
    location.href = '/agent/login';
    return;
  }
  if (res.status === 404) return clearActiveRun(localStorage);
  const status = res.ok ? await res.json().catch(() => null) : null;
  if (!status) return;
  if (['completed', 'failed', 'cancelled', 'interrupted'].includes(status.status)) {
    clearActiveRun(localStorage); // finished while we were away: it is already in the conversation
    return;
  }

  // Still going. The conversation shows finished turns only, so show the pending message and replay the rest.
  const lastUser = [...logEl.querySelectorAll('.msg.user .body')].at(-1)?.textContent;
  const turn = beginTurn(active.message, lastUser?.trim() !== active.message.trim());
  void followRun({ ...active, lastSeq: -1 }, turn);
}

async function renderFinal(target: HTMLElement, text: string) {
  if (!text.trim() || target.classList.contains('error')) return;
  try {
    const { html } = await api('render', { method: 'POST', body: JSON.stringify({ text }) });
    if (typeof html === 'string') target.innerHTML = html; // sanitized on the server
  } catch {
    /* keep the plain text */
  }
}

const APPROVAL_LABELS: Record<string, { label: string; hint: string }> = {
  once: { label: 'Allow once', hint: 'this one command' },
  session: { label: 'Allow for this session', hint: 'similar commands until the session ends' },
  always: { label: 'Always allow', hint: 'permanently, for commands like this' },
  deny: { label: 'Deny', hint: 'do not run it' },
};

function showApproval(ev: any) {
  const box = el('div', 'approval');
  box.setAttribute('role', 'alertdialog');
  box.append(el('strong', '', 'Hermes needs your permission'));
  if (ev.description) box.append(el('p', '', `Reason: ${String(ev.description)}`));
  if (ev.command) box.append(el('pre', '', String(ev.command)));
  const choices: string[] = Array.isArray(ev.choices) ? ev.choices : ['once', 'deny'];
  const row = el('div', 'choices');
  for (const choice of choices) {
    const info = APPROVAL_LABELS[choice] ?? { label: choice, hint: '' };
    const b = el('button', choice === 'deny' ? 'deny' : '', info.label);
    b.type = 'button';
    b.title = info.hint;
    b.addEventListener('click', async () => {
      if (
        choice === 'always' &&
        !(await askConfirm({
          title: 'Always allow commands like this?',
          message: `${String(ev.description ?? ev.command ?? '')}\n\nHermes will stop asking about them from now on.`,
          confirm: 'Always allow',
          danger: true,
        }))
      )
        return;
      row.querySelectorAll('button').forEach((x) => (x.disabled = true));
      try {
        await api(`runs/${ev.run_id ?? runId}/approval`, {
          method: 'POST',
          body: JSON.stringify({ choice, ...(ev.request_id ? { request_id: ev.request_id } : {}) }),
        });
        row.replaceWith(el('p', 'hint', `Answered: ${info.label.toLowerCase()}.`));
        onActivityEvent('approval.answered');
      } catch (e) {
        box.append(el('p', 'hint', (e as Error).message));
        row.querySelectorAll('button').forEach((x) => (x.disabled = false));
      }
    });
    row.append(b);
  }
  box.append(row);
  box.append(el('p', 'hint', 'You can leave this page: Hermes keeps waiting for your answer and the request is here when you come back.'));
  logEl.append(box);
  keepIndicatorLast();
  scrollDown();
}

// ---- wiring --------------------------------------------------------------

form.addEventListener('submit', (e) => {
  e.preventDefault();
  const message = input.value.trim();
  if (!message || controller) return;
  input.value = '';
  send(message).catch((err) => setStatus(err.message));
});

input.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) {
    e.preventDefault();
    form.requestSubmit();
  }
});

titleEl.addEventListener('click', beginTitleEdit);
titleEl.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && e.target === titleEl) beginTitleEdit();
});
renameBtn.addEventListener('click', beginTitleEdit);

stopBtn.addEventListener('click', async () => {
  onActivityEvent('stop.requested');
  if (runId) await api(`runs/${runId}/stop`, { method: 'POST', body: '{}' }).catch((e) => setStatus(e.message));
  setStatus('Stopping…');
});

newBtn.addEventListener('click', () => {
  if (!controller) {
    newChat();
    loadSessions();
  }
});

// No "are you sure you want to leave?" prompt: a chat turn runs on the server, so leaving the page
// does not stop it. Coming back to the conversation picks it up again (see resumeIfRunning).

newChat();
loadSessions();

// /agent/chat?session=<id> opens that conversation (linked from the Sessions page); otherwise, if a
// message was still being answered when this page was left, go back to that conversation.
const wanted = new URLSearchParams(location.search).get('session');
if (wanted && /^[A-Za-z0-9_.:-]{1,128}$/.test(wanted)) {
  void openSession(wanted, 'Session');
} else if (!new URLSearchParams(location.search).has('new')) {
  const pending = loadActiveRun(localStorage);
  if (pending) void openSession(pending.sessionId, 'Chat');
}
