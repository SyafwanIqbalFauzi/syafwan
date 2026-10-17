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

/** Where the runs are kept: one entry per conversation (session id -> ActiveRun). */
export const ACTIVE_RUNS_KEY = 'agent.activeRuns';
/** The old single-run key. Read once and moved into ACTIVE_RUNS_KEY, so a run started before an update is not lost. */
export const LEGACY_RUN_KEY = 'agent.activeRun';
/** A remembered run older than this is forgotten (a turn never legitimately takes this long). */
export const MAX_RUN_AGE_MS = 6 * 3600 * 1000;
/** Conversations that may be answering at the same time from one browser. */
export const MAX_ACTIVE_RUNS = 5;

const RUN_ID = /^[A-Za-z0-9_.:-]{1,128}$/;

function validRun(run: Partial<ActiveRun> | null | undefined, now: number): run is ActiveRun {
  return (
    !!run &&
    typeof run.runId === 'string' && RUN_ID.test(run.runId) &&
    typeof run.sessionId === 'string' && RUN_ID.test(run.sessionId) &&
    typeof run.message === 'string' &&
    typeof run.lastSeq === 'number' && Number.isFinite(run.lastSeq) &&
    typeof run.startedAt === 'number' && now - run.startedAt <= MAX_RUN_AGE_MS
  );
}

function write(store: KeyValueStore, runs: ActiveRun[]): void {
  try {
    if (runs.length === 0) store.removeItem(ACTIVE_RUNS_KEY);
    else store.setItem(ACTIVE_RUNS_KEY, JSON.stringify(Object.fromEntries(runs.map((r) => [r.sessionId, r]))));
  } catch {
    /* private mode / quota: the runs still work, they just cannot be re-attached after a reload */
  }
}

/** Every remembered run, newest first. Stale or malformed entries are dropped; the old single-run entry is migrated. */
export function loadActiveRuns(store: KeyValueStore, now = Date.now()): ActiveRun[] {
  let changed = false;
  const runs = new Map<string, ActiveRun>();
  try {
    const parsed: unknown = JSON.parse(store.getItem(ACTIVE_RUNS_KEY) ?? '{}');
    const entries = parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? Object.values(parsed) : [];
    for (const entry of entries) {
      if (validRun(entry as Partial<ActiveRun>, now)) runs.set((entry as ActiveRun).sessionId, entry as ActiveRun);
      else changed = true;
    }
  } catch {
    changed = true;
  }
  try {
    const legacy = store.getItem(LEGACY_RUN_KEY);
    if (legacy !== null) {
      const old = JSON.parse(legacy) as Partial<ActiveRun>;
      if (validRun(old, now) && !runs.has(old.sessionId)) runs.set(old.sessionId, old);
      store.removeItem(LEGACY_RUN_KEY);
      changed = true;
    }
  } catch {
    try {
      store.removeItem(LEGACY_RUN_KEY);
    } catch {
      /* ignore */
    }
  }
  const list = [...runs.values()].sort((a, b) => b.startedAt - a.startedAt);
  if (changed) write(store, list);
  return list;
}

export function loadActiveRun(store: KeyValueStore, sessionId: string, now = Date.now()): ActiveRun | null {
  return loadActiveRuns(store, now).find((r) => r.sessionId === sessionId) ?? null;
}

/** Remember (or update) the run of one conversation. Keeps at most MAX_ACTIVE_RUNS: the oldest entries go first. */
export function saveActiveRun(store: KeyValueStore, run: ActiveRun, now = Date.now()): void {
  const others = loadActiveRuns(store, now).filter((r) => r.sessionId !== run.sessionId);
  write(store, [run, ...others].slice(0, MAX_ACTIVE_RUNS));
}

export function clearActiveRun(store: KeyValueStore, sessionId: string, now = Date.now()): void {
  write(store, loadActiveRuns(store, now).filter((r) => r.sessionId !== sessionId));
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
