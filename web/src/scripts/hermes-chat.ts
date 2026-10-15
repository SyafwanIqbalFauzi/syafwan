// Browser side of /hermes: session list, streaming chat, tool cards, approvals, stop.
// Everything goes through /api/hermes/* (see src/pages/api/hermes/[...path].ts).
import { SseParser } from '../lib/sse';

const $ = <T extends HTMLElement>(sel: string) => document.querySelector(sel) as T;
const sessionsEl = $<HTMLUListElement>('#sessions');
const logEl = $<HTMLDivElement>('#log');
const titleEl = $<HTMLElement>('#title');
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
  const res = await fetch(`/api/hermes/${path}`, {
    ...init,
    headers: init.body ? { 'Content-Type': 'application/json' } : undefined,
    credentials: 'same-origin',
  });
  if (res.status === 401) {
    location.href = '/hermes/login';
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
        open.addEventListener('click', () => id && openSession(id, open.textContent ?? ''));
        const rename = el('button', 'mini', 'rename');
        rename.addEventListener('click', async () => {
          const title = prompt('Session title', s.title ?? '');
          if (title && id) {
            await api(`sessions/${id}`, { method: 'PATCH', body: JSON.stringify({ title }) }).catch((e) => setStatus(e.message));
            loadSessions();
          }
        });
        const del = el('button', 'mini', 'delete');
        del.addEventListener('click', async () => {
          if (!id || !confirm('Delete this session?')) return;
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

function newChat() {
  sessionId = null;
  runId = null;
  titleEl.textContent = 'New chat';
  logEl.replaceChildren(el('p', 'hint', 'Ask Hermes anything. It can run commands on the server, so approvals will appear here.'));
  input.focus();
}

async function openSession(id: string, title: string) {
  sessionId = id;
  titleEl.textContent = title;
  logEl.replaceChildren(el('p', 'hint', 'Loading…'));
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
}

function addBubble(role: 'user' | 'assistant'): HTMLDivElement {
  const wrap = el('div', `msg ${role}`);
  const body = el('div', 'body');
  wrap.append(body);
  logEl.append(wrap);
  return body;
}

// ---- chat turn -----------------------------------------------------------

async function send(message: string) {
  if (!sessionId) {
    const created = await api('sessions', { method: 'POST', body: '{}' });
    sessionId = idOf(created?.session ?? created);
    if (!sessionId) throw new Error('Could not create a session');
    titleEl.textContent = message.slice(0, 60);
  }
  logEl.querySelector('.hint')?.remove();
  addBubble('user').textContent = message;
  const reply = addBubble('assistant');
  reply.classList.add('streaming');
  let streamed = '';
  const toolCards: HTMLElement[] = [];

  controller = new AbortController();
  runId = null;
  setBusy(true);
  setStatus('Working…');
  scrollDown();

  try {
    const res = await fetch(`/api/hermes/sessions/${sessionId}/chat/stream`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ input: message }),
      credentials: 'same-origin',
      signal: controller.signal,
    });
    if (res.status === 401) {
      location.href = '/hermes/login';
      return;
    }
    if (!res.ok || !res.body) {
      const data = await res.json().catch(() => null);
      throw new Error(data?.error?.message ?? data?.error ?? `Request failed (${res.status})`);
    }

    const parser = new SseParser();
    const decoder = new TextDecoder();
    const reader = res.body.getReader();
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      for (const ev of parser.push(decoder.decode(value, { stream: true }))) {
        let data: any;
        try {
          data = JSON.parse(ev.data);
        } catch {
          continue;
        }
        if (data?.run_id) runId = data.run_id;

        switch (ev.event) {
          case 'assistant.delta':
            streamed += data.delta ?? '';
            reply.textContent = streamed;
            break;
          case 'tool.started': {
            const card = el('div', 'tool running');
            card.append(el('strong', '', data.tool_name ?? 'tool'), el('span', '', ` ${data.preview ?? ''}`.slice(0, 200)));
            logEl.insertBefore(card, reply.parentElement);
            toolCards.push(card);
            break;
          }
          case 'tool.completed':
          case 'tool.failed': {
            const card = toolCards.find((c) => c.classList.contains('running') && c.firstElementChild?.textContent === data.tool_name);
            card?.classList.remove('running');
            if (ev.event === 'tool.failed') card?.classList.add('failed');
            break;
          }
          case 'approval.request':
            showApproval(data);
            break;
          case 'assistant.completed':
            streamed = data.content ?? streamed;
            reply.textContent = streamed;
            break;
          case 'error':
            reply.classList.add('error');
            reply.textContent = data.message ?? 'Something went wrong.';
            break;
        }
        scrollDown();
      }
    }
    await renderFinal(reply, streamed);
  } catch (e) {
    if ((e as Error).name !== 'AbortError') {
      reply.classList.add('error');
      reply.textContent = (e as Error).message;
    }
  } finally {
    reply.classList.remove('streaming');
    controller = null;
    runId = null;
    setBusy(false);
    setStatus('');
    loadSessions();
  }
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

function showApproval(ev: any) {
  const box = el('div', 'approval');
  box.append(el('strong', '', 'Approval needed'));
  if (ev.description) box.append(el('p', '', String(ev.description)));
  if (ev.command) box.append(el('pre', '', String(ev.command)));
  const choices: string[] = Array.isArray(ev.choices) ? ev.choices : ['once', 'deny'];
  const row = el('div', 'choices');
  for (const choice of choices) {
    const b = el('button', choice === 'deny' ? 'deny' : '', choice);
    b.type = 'button';
    b.addEventListener('click', async () => {
      row.querySelectorAll('button').forEach((x) => (x.disabled = true));
      try {
        await api(`runs/${ev.run_id ?? runId}/approval`, {
          method: 'POST',
          body: JSON.stringify({ choice, ...(ev.request_id ? { request_id: ev.request_id } : {}) }),
        });
        box.append(el('p', 'hint', `Answered: ${choice}`));
      } catch (e) {
        box.append(el('p', 'hint', (e as Error).message));
      }
    });
    row.append(b);
  }
  box.append(row);
  logEl.append(box);
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

stopBtn.addEventListener('click', async () => {
  if (runId) await api(`runs/${runId}/stop`, { method: 'POST', body: '{}' }).catch((e) => setStatus(e.message));
  setStatus('Stopping…');
});

newBtn.addEventListener('click', () => {
  if (!controller) {
    newChat();
    loadSessions();
  }
});

// Closing the tab drops the stream, which interrupts the run on the server.
window.addEventListener('beforeunload', (e) => {
  if (controller) e.preventDefault();
});

newChat();
loadSessions();

// /hermes/chat?session=<id> opens that conversation (linked from the Sessions page).
const wanted = new URLSearchParams(location.search).get('session');
if (wanted && /^[A-Za-z0-9_.:-]{1,128}$/.test(wanted)) openSession(wanted, 'Session');
