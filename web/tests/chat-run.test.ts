import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  ACTIVE_RUNS_KEY,
  clearActiveRun,
  LEGACY_RUN_KEY,
  loadActiveRun,
  loadActiveRuns,
  MAX_ACTIVE_RUNS,
  MAX_RUN_AGE_MS,
  saveActiveRun,
  watchRun,
  type ActiveRun,
  type KeyValueStore,
  type RunEvent,
} from '../src/lib/chat-run.ts';

const memoryStore = (): KeyValueStore & { map: Map<string, string> } => {
  const map = new Map<string, string>();
  return { map, getItem: (k) => map.get(k) ?? null, setItem: (k, v) => void map.set(k, v), removeItem: (k) => void map.delete(k) };
};

const run = (over: Partial<ActiveRun> = {}): ActiveRun => ({ runId: 'run_abc', sessionId: 'api_1_x', message: 'hi', lastSeq: -1, startedAt: 1000, ...over });

test('active runs: one per conversation, saved, loaded and cleared separately', () => {
  const store = memoryStore();
  assert.deepEqual(loadActiveRuns(store, 2000), []);
  saveActiveRun(store, run(), 2000);
  saveActiveRun(store, run({ runId: 'run_b', sessionId: 'api_2_y', startedAt: 1500 }), 2000);
  assert.deepEqual(loadActiveRuns(store, 2000).map((r) => r.runId), ['run_b', 'run_abc']); // newest first
  assert.deepEqual(loadActiveRun(store, 'api_1_x', 2000), run());
  assert.equal(loadActiveRun(store, 'nope', 2000), null);
  clearActiveRun(store, 'api_1_x', 2000);
  assert.deepEqual(loadActiveRuns(store, 2000).map((r) => r.runId), ['run_b']);
  clearActiveRun(store, 'api_2_y', 2000);
  assert.equal(store.map.has(ACTIVE_RUNS_KEY), false);
});

test('active runs: saving the same conversation again replaces its entry', () => {
  const store = memoryStore();
  saveActiveRun(store, run({ lastSeq: 1 }), 2000);
  saveActiveRun(store, run({ lastSeq: 7 }), 2000);
  const all = loadActiveRuns(store, 2000);
  assert.equal(all.length, 1);
  assert.equal(all[0]!.lastSeq, 7);
});

test('active runs: at most MAX_ACTIVE_RUNS are kept, the oldest go first', () => {
  const store = memoryStore();
  for (let i = 0; i < MAX_ACTIVE_RUNS + 2; i++) saveActiveRun(store, run({ runId: `run_${i}`, sessionId: `s_${i}`, startedAt: 1000 + i }), 2000);
  const ids = loadActiveRuns(store, 2000).map((r) => r.runId);
  assert.equal(ids.length, MAX_ACTIVE_RUNS);
  assert.equal(ids[0], `run_${MAX_ACTIVE_RUNS + 1}`);
  assert.equal(ids.includes('run_0'), false);
});

test('active runs: stale, corrupt or malformed entries are dropped', () => {
  const store = memoryStore();
  saveActiveRun(store, run({ startedAt: 0 }), 0);
  assert.deepEqual(loadActiveRuns(store, MAX_RUN_AGE_MS + 1), []);
  assert.equal(store.map.has(ACTIVE_RUNS_KEY), false); // and forgotten

  store.map.set(ACTIVE_RUNS_KEY, '{not json');
  assert.deepEqual(loadActiveRuns(store, 2000), []);
  store.map.set(ACTIVE_RUNS_KEY, '[1,2]');
  assert.deepEqual(loadActiveRuns(store, 2000), []);
  store.map.set(ACTIVE_RUNS_KEY, JSON.stringify({ a: { ...run(), runId: '../../etc' }, b: { ...run(), lastSeq: 'x' }, c: run({ sessionId: 'good' }) }));
  assert.deepEqual(loadActiveRuns(store, 2000).map((r) => r.sessionId), ['good']);
});

test('active runs: a run saved under the old single key is migrated, not lost', () => {
  const store = memoryStore();
  store.map.set(LEGACY_RUN_KEY, JSON.stringify(run()));
  assert.deepEqual(loadActiveRuns(store, 2000), [run()]);
  assert.equal(store.map.has(LEGACY_RUN_KEY), false);
  assert.deepEqual(loadActiveRuns(store, 2000), [run()]); // now kept under the new key
  store.map.set(LEGACY_RUN_KEY, '{broken');
  assert.deepEqual(loadActiveRuns(store, 2000), [run()]);
  assert.equal(store.map.has(LEGACY_RUN_KEY), false);
});

// ---- watchRun --------------------------------------------------------------------------------

const frame = (seq: number, event: string, extra: Record<string, unknown> = {}) =>
  `id: ${seq}\nevent: ${event}\ndata: ${JSON.stringify({ event, run_id: 'run_abc', seq, ...extra })}\n\n`;

/** A fetch that answers each call with the next scripted response. */
function scripted(responses: (string[] | number)[]) {
  const calls: string[] = [];
  const fetchImpl = (async (url: string) => {
    calls.push(String(url));
    const next = responses.shift();
    if (next === undefined) throw new Error('no more scripted responses');
    if (typeof next === 'number') return { ok: next < 400, status: next, body: null } as unknown as Response;
    const encoder = new TextEncoder();
    const chunks = next.map((c) => encoder.encode(c));
    return {
      ok: true,
      status: 200,
      body: new ReadableStream({
        start(controller) {
          for (const c of chunks) controller.enqueue(c);
          controller.close();
        },
      }),
    } as unknown as Response;
  }) as unknown as typeof fetch;
  return { fetchImpl, calls };
}

const instant = async () => {};

async function watch(responses: (string[] | number)[], overrides: Partial<Parameters<typeof watchRun>[0]> = {}) {
  const { fetchImpl, calls } = scripted(responses);
  const events: RunEvent[] = [];
  const progress: number[] = [];
  const result = await watchRun({
    fetchImpl,
    runId: 'run_abc',
    lastSeq: -1,
    signal: new AbortController().signal,
    onEvent: (e) => events.push(e),
    onProgress: (n) => progress.push(n),
    sleep: instant,
    ...overrides,
  });
  return { result, events, calls, progress };
}

test('watchRun: follows a run to its end', async () => {
  const { result, events, calls, progress } = await watch([[frame(0, 'tool.started', { tool: 'terminal' }), frame(1, 'message.delta', { delta: 'Hi' }), frame(2, 'run.completed', { output: 'Hi' })]]);
  assert.equal(result, 'terminal');
  assert.deepEqual(events.map((e) => e.name), ['tool.started', 'message.delta', 'run.completed']);
  assert.deepEqual(progress, [0, 1, 2]);
  assert.equal(calls.length, 1);
  assert.match(calls[0], /\/api\/agent\/runs\/run_abc\/events\?last_seq=-1$/);
});

test('watchRun: handles events split across chunks and ignores keep-alive comments', async () => {
  const text = frame(0, 'message.delta', { delta: 'A' }) + ': keepalive\n\n' + frame(1, 'run.completed', { output: 'A' });
  const cut = Math.floor(text.length / 2);
  const { result, events } = await watch([[text.slice(0, cut), text.slice(cut)]]);
  assert.equal(result, 'terminal');
  assert.deepEqual(events.map((e) => e.name), ['message.delta', 'run.completed']);
});

test('watchRun: a dropped connection re-attaches from the last event, with nothing shown twice', async () => {
  const { result, events, calls } = await watch([
    [frame(0, 'message.delta', { delta: 'one ' }), frame(1, 'message.delta', { delta: 'two ' })], // stream ends: dropped
    [frame(1, 'message.delta', { delta: 'two ' }), frame(2, 'message.delta', { delta: 'three' }), frame(3, 'run.completed', { output: 'one two three' })], // server replays an overlap
  ]);
  assert.equal(result, 'terminal');
  assert.deepEqual(events.map((e) => e.seq), [0, 1, 2, 3]); // seq 1 was not shown a second time
  assert.equal(calls.length, 2);
  assert.match(calls[1], /last_seq=1$/);
});

test('watchRun: several drops in a row still recover', async () => {
  const { result, calls } = await watch([[frame(0, 'message.delta')], 502, [frame(1, 'message.delta')], [frame(2, 'run.completed')]]);
  assert.equal(result, 'terminal');
  assert.equal(calls.length, 4);
  assert.match(calls[3], /last_seq=1$/);
});

test('watchRun: a run the server no longer knows is reported as lost', async () => {
  const { result, events } = await watch([404]);
  assert.equal(result, 'lost');
  assert.equal(events.length, 0);
});

test('watchRun: signed out is reported, not retried', async () => {
  const { result, calls } = await watch([401]);
  assert.equal(result, 'signed-out');
  assert.equal(calls.length, 1);
});

test('watchRun: gives up after too many consecutive failures', async () => {
  const { result, calls } = await watch([500, 500, 500, 500, 500], { maxFailures: 3 });
  assert.equal(result, 'lost');
  assert.equal(calls.length, 4);
});

test('watchRun: progress resets the failure count', async () => {
  // Alternate failure / one event: with maxFailures 2 it must never give up.
  const { result } = await watch([500, [frame(0, 'message.delta')], 500, [frame(1, 'message.delta')], 500, [frame(2, 'run.completed')]], { maxFailures: 2 });
  assert.equal(result, 'terminal');
});

test('watchRun: aborting stops it without further requests', async () => {
  const controller = new AbortController();
  const { fetchImpl, calls } = scripted([[frame(0, 'message.delta')], [frame(1, 'run.completed')]]);
  const events: RunEvent[] = [];
  const result = await watchRun({
    fetchImpl,
    runId: 'run_abc',
    lastSeq: -1,
    signal: controller.signal,
    onEvent: (e) => {
      events.push(e);
      controller.abort(); // the page was left
    },
    sleep: instant,
  });
  assert.equal(result, 'aborted');
  assert.equal(calls.length, 1);
  assert.equal(events.length, 1);
});

test('watchRun: starts from the position it is given', async () => {
  const { calls } = await watch([[frame(8, 'run.completed')]], { lastSeq: 7 });
  assert.match(calls[0], /last_seq=7$/);
});

test('watchRun: failed and cancelled runs end the watch too', async () => {
  assert.equal((await watch([[frame(0, 'run.failed', { error: 'x' })]])).result, 'terminal');
  assert.equal((await watch([[frame(0, 'run.cancelled')]])).result, 'terminal');
});
