// Watching a Hermes run from the browser.
//
// A chat turn is a run on the server: it keeps going when the page is closed, reloaded or left for
// another page. The browser only *watches* it. This module holds the two parts that make that work:
//   - ActiveRun: which run the browser was watching (kept in storage, so the next page can re-attach)
//   - watchRun:  read the run's event stream and, if the connection drops, re-attach from the last
//                event seen (the server replays what was missed), without showing anything twice.
// Everything the network/storage does is injected, so it is unit-tested without a browser.
import { SseParser } from './sse.ts';

export interface ActiveRun {
  runId: string;
  sessionId: string;
  /** The text that was sent, so a reloaded page can show it while the answer is still in flight. */
  message: string;
  /** Last event sequence number shown; -1 = none yet. */
  lastSeq: number;
  startedAt: number;
}

export interface KeyValueStore {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

export const ACTIVE_RUN_KEY = 'agent.activeRun';
/** A remembered run older than this is forgotten (a turn never legitimately takes this long). */
export const MAX_RUN_AGE_MS = 6 * 3600 * 1000;

const RUN_ID = /^[A-Za-z0-9_.:-]{1,128}$/;

export function loadActiveRun(store: KeyValueStore, now = Date.now()): ActiveRun | null {
  try {
    const raw = store.getItem(ACTIVE_RUN_KEY);
    if (!raw) return null;
    const run = JSON.parse(raw) as Partial<ActiveRun>;
    if (
      typeof run.runId !== 'string' || !RUN_ID.test(run.runId) ||
      typeof run.sessionId !== 'string' || !RUN_ID.test(run.sessionId) ||
      typeof run.message !== 'string' ||
      typeof run.lastSeq !== 'number' || !Number.isFinite(run.lastSeq) ||
      typeof run.startedAt !== 'number' || now - run.startedAt > MAX_RUN_AGE_MS
    ) {
      store.removeItem(ACTIVE_RUN_KEY);
      return null;
    }
    return run as ActiveRun;
  } catch {
    return null;
  }
}

export function saveActiveRun(store: KeyValueStore, run: ActiveRun): void {
  try {
    store.setItem(ACTIVE_RUN_KEY, JSON.stringify(run));
  } catch {
    /* private mode / quota: the run still works, it just cannot be re-attached after a reload */
  }
}

export function clearActiveRun(store: KeyValueStore): void {
  try {
    store.removeItem(ACTIVE_RUN_KEY);
  } catch {
    /* ignore */
  }
}

export interface RunEvent {
  name: string;
  data: Record<string, any>;
  seq: number | null;
}

export const TERMINAL_EVENTS = new Set(['run.completed', 'run.failed', 'run.cancelled', 'run.interrupted']);

export type WatchResult = 'terminal' | 'aborted' | 'lost' | 'signed-out';

export interface WatchOptions {
  fetchImpl: typeof fetch;
  runId: string;
  /** Last event already shown; the server replays everything after it. */
  lastSeq: number;
  signal: AbortSignal;
  onEvent: (event: RunEvent) => void;
  /** Called with the new position after every event (to keep ActiveRun.lastSeq current). */
  onProgress?: (lastSeq: number) => void;
  /** Consecutive failed attempts before giving up. */
  maxFailures?: number;
  retryDelayMs?: (failures: number) => number;
  sleep?: (ms: number, signal: AbortSignal) => Promise<void>;
}

const defaultSleep = (ms: number, signal: AbortSignal) =>
  new Promise<void>((resolve) => {
    if (signal.aborted) return resolve();
    const timer = setTimeout(resolve, ms);
    signal.addEventListener('abort', () => (clearTimeout(timer), resolve()), { once: true });
  });

/** Follow a run until it ends. Re-attaches on its own if the connection drops. */
export async function watchRun(options: WatchOptions): Promise<WatchResult> {
  const { fetchImpl, runId, signal, onEvent, onProgress } = options;
  const maxFailures = options.maxFailures ?? 12;
  const delay = options.retryDelayMs ?? ((n: number) => Math.min(1000 * 2 ** (n - 1), 8000));
  const sleep = options.sleep ?? defaultSleep;
  let last = options.lastSeq;
  let failures = 0;

  while (!signal.aborted) {
    let received = false;
    try {
      const res = await fetchImpl(`/api/agent/runs/${encodeURIComponent(runId)}/events?last_seq=${last}`, {
        credentials: 'same-origin',
        signal,
        headers: { Accept: 'text/event-stream' },
      });
      if (res.status === 401) return 'signed-out';
      if (res.status === 404) return 'lost'; // the server no longer knows this run
      if (!res.ok || !res.body) throw new Error(`HTTP ${res.status}`);

      const parser = new SseParser();
      const decoder = new TextDecoder();
      const reader = res.body.getReader();
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        for (const frame of parser.push(decoder.decode(value, { stream: true }))) {
          let data: Record<string, any>;
          try {
            data = JSON.parse(frame.data);
          } catch {
            continue;
          }
          const seq = typeof data.seq === 'number' ? data.seq : null;
          if (seq !== null && seq <= last) continue; // already shown (replay overlap)
          received = true;
          if (seq !== null) {
            last = seq;
            onProgress?.(last);
          }
          const name = typeof data.event === 'string' ? data.event : frame.event;
          onEvent({ name, data, seq });
          if (TERMINAL_EVENTS.has(name)) return 'terminal';
        }
      }
      // The stream ended without a terminal event: the connection dropped. Re-attach below.
    } catch (error) {
      if (signal.aborted || (error as Error).name === 'AbortError') return 'aborted';
    }

    failures = received ? 0 : failures + 1;
    if (failures > maxFailures) return 'lost';
    await sleep(delay(Math.max(1, failures)), signal);
  }
  return 'aborted';
}
