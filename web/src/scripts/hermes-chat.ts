// Browser side of /agent/chat: session list, a chat turn as a server-side run (watch/re-attach), tool cards, approvals, stop.
// Everything goes through /api/agent/* (see src/pages/api/agent/[...path].ts).
import { describeActivity, isWaitingForPerson, nextActivity, type Activity } from '../lib/chat-activity';
import { normalizeTitle, titleFromMessage } from '../lib/chat-title';
import { askConfirm, askText } from './dialog';
import { alertFor, alertUser, firstTime } from '../lib/notify';
import { toast } from './toast';
import { approvalKey, clearActiveRun, loadActiveRun, loadActiveRuns, MAX_ACTIVE_RUNS, pendingApproval, pollRun, saveActiveRun, watchRun, type ActiveRun, type RunEvent, type WatchResult } from '../lib/chat-run';
import { markerText, type RunState } from '../lib/run-badge';
import { fitWithin, imageSourcesOf, MAX_IMAGES, MAX_IMAGE_DATA_URL_CHARS, textOfContent } from '../lib/chat-images';
import { clampManual, COMPOSER_KEY, composerHeight, heightAfterKey } from '../lib/composer-height';

const $ = <T extends HTMLElement>(sel: string) => document.querySelector(sel) as T;
const sessionsEl = $<HTMLUListElement>('#sessions');
const logEl = $<HTMLDivElement>('#log');
const titleEl = $<HTMLElement>('#title');
const renameBtn = $<HTMLButtonElement>('#rename-title');
const form = $<HTMLFormElement>('#composer');
const input = $<HTMLTextAreaElement>('#input');
const sendBtn = $<HTMLButtonElement>('#send');
const stopBtn = $<HTMLButtonElement>('#stop');
const attachBtn = $<HTMLButtonElement>('#attach');
const fileInput = $<HTMLInputElement>('#file');
const attachmentsEl = $<HTMLUListElement>('#attachments');
const newBtn = $<HTMLButtonElement>('#new-chat');
const statusEl = $<HTMLElement>('#status');
const chatEl = $<HTMLElement>('.chat');
const chatsToggle = $<HTMLButtonElement>('#chats-toggle');
const grip = $<HTMLElement>('#grip');

// ---- message box height: grows with the text, and can be pulled taller by hand ---------------

const visibleHeight = () => window.visualViewport?.height ?? window.innerHeight;
let manualHeight = 0; // px set with the handle; 0 = follow the text only
try {
  manualHeight = clampManual(localStorage.getItem(COMPOSER_KEY), visibleHeight());
} catch {
  /* storage blocked: the height just is not remembered */
}

function fitInput() {
  input.style.height = 'auto'; // measure the text at its natural height
  const borders = input.offsetHeight - input.clientHeight;
  input.style.height = `${composerHeight(input.scrollHeight + borders, manualHeight, visibleHeight())}px`;
}

function setManualHeight(px: number, remember: boolean) {
  manualHeight = clampManual(px, visibleHeight());
  if (remember) {
    try {
      if (manualHeight) localStorage.setItem(COMPOSER_KEY, String(manualHeight));
      else localStorage.removeItem(COMPOSER_KEY);
    } catch {
      /* not remembered */
    }
  }
  fitInput();
}

input.addEventListener('input', fitInput);
window.addEventListener('resize', fitInput);
window.visualViewport?.addEventListener('resize', fitInput);

grip.addEventListener('pointerdown', (e) => {
  e.preventDefault();
  const startY = e.clientY;
  const startH = input.offsetHeight;
  grip.setPointerCapture(e.pointerId);
  grip.classList.add('dragging');
  const move = (ev: PointerEvent) => setManualHeight(startH + (startY - ev.clientY), false);
  const stop = () => {
    grip.classList.remove('dragging');
    grip.removeEventListener('pointermove', move);
    grip.removeEventListener('pointerup', stop);
    grip.removeEventListener('pointercancel', stop);
    setManualHeight(manualHeight, true);
  };
  grip.addEventListener('pointermove', move);
  grip.addEventListener('pointerup', stop);
  grip.addEventListener('pointercancel', stop);
});
grip.addEventListener('keydown', (e) => {
  const next = heightAfterKey(e.key, Math.max(manualHeight, input.offsetHeight), visibleHeight());
  if (next === null) return;
  e.preventDefault();
  setManualHeight(next, true);
});
grip.addEventListener('dblclick', () => setManualHeight(0, true));
fitInput();

let sessionId: string | null = null;
let runId: string | null = null;
let controller: AbortController | null = null;

// Which conversations are being answered (working / needs you / done). The sidebar checks the server
// every few seconds and announces the result as an 'agent:runs' event; this page only paints it.
let runStates = new Map<string, RunState>(Object.entries((window as any).__agentRunStates ?? {}) as [string, RunState][]);

/** Tell the sidebar that the remembered runs changed, so its badge and the list markers are refreshed now. */
const runsChanged = () => window.dispatchEvent(new Event('agent:run-saved'));

function paintMarkers() {
  sessionsEl.querySelectorAll<HTMLElement>('li[data-session]').forEach((li) => {
    const state = runStates.get(li.dataset.session ?? '');
    const flag = li.querySelector<HTMLElement>('.run-flag');
    if (!flag) return;
    flag.hidden = !state;
    if (state) {
      flag.textContent = markerText(state);
      flag.dataset.state = state;
    }
  });
}

window.addEventListener('agent:runs', (event) => {
  runStates = new Map(Object.entries((event as CustomEvent).detail ?? {}) as [string, RunState][]);
  paintMarkers();
});

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
const textOf = textOfContent;

function el<K extends keyof HTMLElementTagNameMap>(tag: K, cls = '', text = ''): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (cls) node.className = cls;
  if (text) node.textContent = text;
  return node;
}

const scrollDown = () => logEl.scrollTo({ top: logEl.scrollHeight });
const setStatus = (text: string) => (statusEl.textContent = text);

// A phone's keyboard pops up whenever the box is focused from code, and then covers the screen. Only a
// mouse-and-keyboard device gets the automatic focus; on a touch screen the person taps the box.
// The long placeholder (with keyboard shortcuts) does not fit the narrow box on a phone.
if (window.matchMedia('(pointer: coarse)').matches) input.placeholder = 'Message Hermes';

const autoFocus = () => {
  if (window.matchMedia('(pointer: fine)').matches) input.focus();
};

function setBusy(busy: boolean) {
  sendBtn.hidden = busy;
  stopBtn.hidden = !busy;
  input.disabled = busy;
  attachBtn.disabled = busy;
  if (!busy) autoFocus();
}

// Keep the page exactly as tall as what is visible. When the on-screen keyboard opens, iPhones shrink only
// the visual viewport (not dvh), which would leave the composer behind the keyboard.
const viewport = window.visualViewport;
if (viewport) {
  const fit = () => {
    const keyboard = window.innerHeight - viewport.height > 120;
    document.documentElement.style.setProperty('--app-h', keyboard ? `${Math.round(viewport.height)}px` : '');
    document.documentElement.toggleAttribute('data-keyboard', keyboard);
    if (keyboard) window.scrollTo(0, 0); // iOS pans the page up to the focused box; the layout already fits
  };
  viewport.addEventListener('resize', fit);
  viewport.addEventListener('scroll', fit);
  fit();
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
        if (id) li.dataset.session = id;
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
          const deleted = await api(`sessions/${id}`, { method: 'DELETE' }).then(() => true, (e) => {
            setStatus(e.message);
            toast(e.message, 'error');
            return false;
          });
          if (deleted) {
            toast(`Chat “${label}” deleted`);
            clearActiveRun(localStorage, id);
            runsChanged();
          }
          if (id === sessionId) newChat();
          loadSessions();
        });
        const flag = el('span', 'run-flag');
        flag.hidden = true;
        li.append(open, flag, rename, del);
        return li;
      }),
    );
    paintMarkers();
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
    toast(`Chat renamed to “${title}”`);
    return title;
  } catch (e) {
    setStatus((e as Error).message);
    toast((e as Error).message, 'error');
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

/** Phone only: swap the conversation for the list of conversations (and back). On a wide screen both are always shown. */
function showSessionList(show: boolean) {
  chatEl.classList.toggle('show-sessions', show);
  chatsToggle.setAttribute('aria-expanded', String(show));
  chatsToggle.textContent = show ? 'back' : 'chats';
}

function newChat() {
  showSessionList(false);
  detachFromRun(); // a run in progress keeps going in the background
  sessionId = null;
  runId = null;
  shownApprovals.clear();
  syncTitleControls();
  titleEl.textContent = 'New chat';
  logEl.replaceChildren(el('p', 'hint', 'Ask Hermes anything. It can run commands on the server, so approvals will appear here.'));
  autoFocus();
}

async function openSession(id: string, title: string, opts: { skipResume?: boolean } = {}) {
  showSessionList(false);
  detachFromRun(); // a run in progress elsewhere keeps going; we just stop watching it from here
  sessionId = id;
  syncTitleControls();
  titleEl.textContent = title;
  logEl.replaceChildren(el('p', 'hint', 'Loading…'));
  shownApprovals.clear(); // the log is rebuilt, so a request still pending is drawn again
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
      const pictures = m.role === 'user' ? imageSourcesOf(m.content) : [];
      if (!text.trim() && pictures.length === 0) continue;
      const bubble = addBubble(m.role);
      if (m.role === 'assistant' && typeof m.html === 'string') bubble.innerHTML = m.html;
      else fillUserBubble(bubble, text, pictures);
    }
    if (!logEl.children.length) logEl.append(el('p', 'hint', 'Empty session.'));
    scrollDown();
  } catch (e) {
    logEl.replaceChildren(el('p', 'hint', (e as Error).message));
  }
  loadSessions();
  if (!opts.skipResume && id === sessionId) await resumeIfRunning(id);
}

/** Text plus the pictures that came with a message. Pictures are set as <img src> only (never as HTML). */
function fillUserBubble(body: HTMLElement, text: string, pictures: string[]) {
  if (pictures.length === 0) {
    body.textContent = text;
    return;
  }
  const pics = el('div', 'pics');
  for (const src of pictures) {
    const img = document.createElement('img');
    img.src = src;
    img.alt = 'Attached image';
    img.loading = 'lazy';
    pics.append(img);
  }
  body.replaceChildren(pics, document.createTextNode(text));
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
  run: ActiveRun;
  reply: HTMLElement;
  streamed: string;
  toolCards: HTMLElement[];
}

function beginTurn(run: ActiveRun, showUserBubble: boolean, pictures: string[] = []): Turn {
  const message = run.message;
  logEl.querySelector('.hint')?.remove();
  if (showUserBubble) fillUserBubble(addBubble('user'), message, pictures);
  const reply = addBubble('assistant');
  reply.classList.add('streaming');
  return { run, reply, streamed: '', toolCards: [] };
}

/** Stop watching the current run in this page (the run itself is not touched). */
function detachFromRun() {
  controller?.abort();
  controller = null;
  stopActivity();
  setBusy(false);
}

/** Sound + popup when Hermes needs an answer or has finished (once per run, also across pages). */
function announce(eventName: string, run: ActiveRun) {
  const text = alertFor(eventName, run.message);
  if (text && firstTime(localStorage, run.runId, text.kind)) alertUser(text, { onChatPage: true });
}

function applyRunEvent(ev: RunEvent, turn: Turn) {
  const data = ev.data;
  onActivityEvent(ev.name, data);
  announce(ev.name, turn.run);

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
      logEl.querySelectorAll<HTMLElement>('.approval:not(.done)').forEach((box) => settleApproval(box, String(data.choice ?? '')));
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

  let result: WatchResult = await watchRun({
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

  // Hermes drops the live stream of a run nobody watched for ~5 minutes, while the run itself keeps going
  // (and may be waiting for an answer). Without the stream, follow the run's status: it carries the pending
  // approval, so the question is still shown instead of the page waiting for nothing.
  let followedByStatus = false;
  if (result === 'lost' && controller === mine) {
    followedByStatus = true;
    const polled = await pollRun({
      fetchImpl: fetch,
      runId: run.runId,
      signal: mine.signal,
      onStatus: (status) => {
        const approval = pendingApproval(status);
        if (approval) {
          setStatus('Hermes is waiting for your answer.');
          showApproval({ ...approval, run_id: approval.run_id ?? run.runId });
        } else {
          setStatus('Live view unavailable; following the run.');
        }
      },
    });
    result = polled === 'terminal' || polled === 'gone' ? 'lost' : polled;
  }

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
  clearActiveRun(localStorage, run.sessionId);
  runsChanged();
  runId = null;
  if (result === 'lost') {
    // The server no longer has the live view of this run; whatever Hermes saved is in the conversation.
    setStatus(followedByStatus ? 'Hermes has finished. Showing the conversation…' : 'Lost the live view of this message. Showing what Hermes saved…');
    await openSession(run.sessionId, titleEl.textContent || 'Chat', { skipResume: true });
  } else {
    await renderFinal(turn.reply, turn.streamed);
  }
  loadSessions();
}

async function send(message: string, pictures: string[] = []) {
  // Several conversations may answer at once, up to a limit (each one is watched from here and the sidebar).
  const running = loadActiveRuns(localStorage).filter((r) => r.sessionId !== sessionId);
  if (running.length >= MAX_ACTIVE_RUNS) {
    input.value = message;
    fitInput();
    for (const src of pictures) attachments.push(src);
    renderAttachments();
    setStatus(`${MAX_ACTIVE_RUNS} chats are answering already. Wait for one to finish, or stop one.`);
    toast(`${MAX_ACTIVE_RUNS} chats are answering already`, 'info');
    return;
  }
  if (!sessionId) {
    const created = await api('sessions', { method: 'POST', body: '{}' });
    sessionId = idOf(created?.session ?? created);
    if (!sessionId) throw new Error('Could not create a session');
    titleEl.textContent = message.trim() ? titleFromMessage(message) : 'Image';
    syncTitleControls();
  }
  const placeholder: ActiveRun = { runId: '', sessionId, message, lastSeq: -1, startedAt: Date.now() };
  const turn = beginTurn(placeholder, true, pictures);
  setBusy(true);
  setStatus('');
  try {
    const started = await api('runs', { method: 'POST', body: JSON.stringify({ input: message, images: pictures, session_id: sessionId }) });
    const run: ActiveRun = { ...placeholder, runId: started.run_id };
    turn.run = run;
    saveActiveRun(localStorage, run);
    runsChanged(); // the sidebar starts checking on it
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
  const active = loadActiveRun(localStorage, id);
  if (!active || controller) return;

  const res = await fetch(`/api/agent/runs/${encodeURIComponent(active.runId)}`, { credentials: 'same-origin' }).catch(() => null);
  if (!res) return; // offline: try again next time
  if (res.status === 401) {
    location.href = '/agent/login';
    return;
  }
  if (res.status === 404) {
    clearActiveRun(localStorage, id);
    return runsChanged();
  }
  const status = res.ok ? await res.json().catch(() => null) : null;
  if (!status) return;
  if (['completed', 'failed', 'cancelled', 'interrupted'].includes(status.status)) {
    clearActiveRun(localStorage, id); // finished while we were away: it is already in the conversation
    runsChanged();
    return;
  }

  // Still going. The conversation shows finished turns only, so show the pending message and replay the rest.
  const lastUser = [...logEl.querySelectorAll('.msg.user .body')].at(-1)?.textContent;
  const turn = beginTurn(active, lastUser?.trim() !== active.message.trim());
  // A run waiting for an answer shows its question right away (the status carries it); the stream replay
  // below would show the same request, which showApproval then ignores.
  const waiting = pendingApproval(status);
  if (waiting) showApproval({ ...waiting, run_id: waiting.run_id ?? active.runId });
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

// Requests already drawn in the open conversation: the stream replay and the run status can both report the
// same one, and an answered one must not come back from a late status poll.
const shownApprovals = new Set<string>();

/** Collapse an answered request to one line, so it no longer takes room in the conversation. */
function settleApproval(box: HTMLElement, choice: string) {
  if (box.classList.contains('done')) return;
  const answer = APPROVAL_LABELS[choice]?.label ?? (choice || 'Answered');
  const command = box.dataset.command ?? '';
  box.classList.add('done');
  box.removeAttribute('role');
  box.replaceChildren(el('span', '', command ? `${answer}: ${command}` : answer));
}

function showApproval(ev: any) {
  const key = approvalKey(String(ev.run_id ?? runId ?? ''), ev);
  if (shownApprovals.has(key)) return;
  shownApprovals.add(key);
  const box = el('div', 'approval');
  box.setAttribute('role', 'alertdialog');
  box.dataset.command = String(ev.command ?? ev.description ?? '').replace(/\s+/g, ' ').trim().slice(0, 120);
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
        settleApproval(box, choice);
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
  // Above the reply bubble (like the tool cards), so the answer that follows stays the last thing on screen.
  const reply = [...logEl.querySelectorAll('.msg.assistant')].at(-1);
  if (reply) logEl.insertBefore(box, reply);
  else logEl.append(box);
  keepIndicatorLast();
  scrollDown();
}

// ---- pictures: paste, drop or pick; shrunk in the browser, sent with the message -------------

const attachments: string[] = []; // data URLs waiting to be sent

function renderAttachments() {
  attachmentsEl.replaceChildren();
  attachments.forEach((src, i) => {
    const li = el('li');
    const img = document.createElement('img');
    img.src = src;
    img.alt = `Attached image ${i + 1}`;
    const remove = el('button', '', '×');
    remove.type = 'button';
    remove.setAttribute('aria-label', `Remove image ${i + 1}`);
    remove.addEventListener('click', () => {
      attachments.splice(i, 1);
      renderAttachments();
      input.focus();
    });
    li.append(img, remove);
    attachmentsEl.append(li);
  });
  attachmentsEl.hidden = attachments.length === 0;
}

const readAsDataUrl = (file: Blob) =>
  new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(new Error('Could not read the image'));
    reader.readAsDataURL(file);
  });

/** Shrink to at most 1568 px on the long side (what vision models use anyway) and keep the upload small. */
async function prepareImage(file: File): Promise<string> {
  if (file.type === 'image/gif' && file.size <= 2_000_000) return readAsDataUrl(file); // keeps the animation
  const bitmap = await createImageBitmap(file);
  try {
    for (const [edge, quality] of [[1568, 0.88], [1568, 0.7], [1200, 0.7], [800, 0.6]] as const) {
      const { width, height } = fitWithin(bitmap.width, bitmap.height, edge);
      const canvas = document.createElement('canvas');
      canvas.width = width;
      canvas.height = height;
      const ctx = canvas.getContext('2d');
      if (!ctx) throw new Error('Could not process the image');
      ctx.fillStyle = '#fff'; // transparent PNGs become white instead of black
      ctx.fillRect(0, 0, width, height);
      ctx.drawImage(bitmap, 0, 0, width, height);
      const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/jpeg', quality));
      if (!blob) throw new Error('Could not process the image');
      const url = await readAsDataUrl(blob);
      if (url.length <= MAX_IMAGE_DATA_URL_CHARS) return url;
    }
  } finally {
    bitmap.close();
  }
  throw new Error('That image is too large');
}

async function addImages(files: File[]) {
  const images = files.filter((f) => /^image\/(png|jpeg|webp|gif)$/.test(f.type));
  if (images.length === 0) {
    if (files.length) toast('Only PNG, JPEG, WebP or GIF images are supported', 'info');
    return;
  }
  for (const file of images) {
    if (attachments.length >= MAX_IMAGES) {
      toast(`At most ${MAX_IMAGES} images per message`, 'info');
      break;
    }
    try {
      attachments.push(await prepareImage(file));
      renderAttachments();
    } catch (e) {
      toast((e as Error).message, 'info');
    }
  }
}

input.addEventListener('paste', (e) => {
  const files = [...(e.clipboardData?.files ?? [])].filter((f) => f.type.startsWith('image/'));
  if (files.length === 0) return; // plain text paste: leave it alone
  e.preventDefault();
  void addImages(files);
});

attachBtn.addEventListener('click', () => fileInput.click());
fileInput.addEventListener('change', () => {
  void addImages([...(fileInput.files ?? [])]);
  fileInput.value = '';
});

form.addEventListener('dragover', (e) => {
  if (![...(e.dataTransfer?.types ?? [])].includes('Files')) return;
  e.preventDefault();
  form.classList.add('dragging');
});
form.addEventListener('dragleave', () => form.classList.remove('dragging'));
form.addEventListener('drop', (e) => {
  form.classList.remove('dragging');
  const files = [...(e.dataTransfer?.files ?? [])];
  if (files.length === 0) return;
  e.preventDefault();
  void addImages(files);
});

// Click a picture in the conversation to see it large.
logEl.addEventListener('click', (e) => {
  const img = e.target instanceof HTMLImageElement && e.target.closest('.pics, .msg.assistant .body') ? e.target : null;
  if (!img) return;
  const overlay = el('div', 'lightbox');
  overlay.style.cssText = 'position:fixed;inset:0;z-index:1000;background:rgba(0,0,0,.85);display:grid;place-items:center;cursor:zoom-out;padding:24px';
  const big = document.createElement('img');
  big.src = img.src;
  big.alt = img.alt;
  big.style.cssText = 'max-width:100%;max-height:100%;object-fit:contain';
  overlay.append(big);
  const close = () => (overlay.remove(), document.removeEventListener('keydown', onKey));
  const onKey = (ev: KeyboardEvent) => ev.key === 'Escape' && close();
  overlay.addEventListener('click', close);
  document.addEventListener('keydown', onKey);
  document.body.append(overlay);
});

// ---- wiring --------------------------------------------------------------

form.addEventListener('submit', (e) => {
  e.preventDefault();
  const message = input.value.trim();
  if ((!message && attachments.length === 0) || controller) return;
  const pictures = attachments.splice(0);
  renderAttachments();
  input.value = '';
  fitInput();
  send(message, pictures).catch((err) => setStatus(err.message));
});

// Enter never sends: it always adds a new line. Sending is only via the Send button.

chatsToggle.addEventListener('click', () => showSessionList(!chatEl.classList.contains('show-sessions')));

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

// Always available: a conversation that is still answering keeps going on the server while you start another.
newBtn.addEventListener('click', () => {
  newChat();
  loadSessions();
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
  const pending = loadActiveRuns(localStorage)[0]; // the one started last
  if (pending) void openSession(pending.sessionId, 'Chat');
}
