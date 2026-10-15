import assert from 'node:assert/strict';
import { test } from 'node:test';
import { alertFor, alertsEnabled, firstTime, NOTIFIED_KEY, type KeyValueStore } from '../src/lib/notify.ts';

const memory = (): KeyValueStore & { map: Map<string, string> } => {
  const map = new Map<string, string>();
  return { map, getItem: (k) => map.get(k) ?? null, setItem: (k, v) => void map.set(k, v) };
};

test('alertFor: approval, done and failed are announced; running is not', () => {
  assert.equal(alertFor('waiting_for_approval', 'deploy it')?.kind, 'approval');
  assert.equal(alertFor('approval.request')?.kind, 'approval');
  assert.equal(alertFor('completed')?.kind, 'done');
  assert.equal(alertFor('run.completed')?.kind, 'done');
  assert.equal(alertFor('run.failed')?.kind, 'failed');
  for (const quiet of ['running', 'cancelled', 'interrupted', 'message.delta', '']) assert.equal(alertFor(quiet), null);
});

test('alertFor: quotes a shortened one-line version of the message', () => {
  const text = alertFor('completed', `line one\n${'x'.repeat(300)}`)!;
  assert.match(text.body, /^“line one x+…” — /);
  assert.ok(text.body.length < 140);
  assert.match(alertFor('completed')!.body, /^Your message/);
});

test('firstTime: alerts once per run and kind, and remembers only the latest few', () => {
  const store = memory();
  assert.equal(firstTime(store, 'run_a', 'approval'), true);
  assert.equal(firstTime(store, 'run_a', 'approval'), false);
  assert.equal(firstTime(store, 'run_a', 'done'), true);
  assert.equal(firstTime(store, 'run_b', 'approval'), true);
  for (let i = 0; i < 40; i++) firstTime(store, `run_${i}`, 'done');
  assert.ok(JSON.parse(store.map.get(NOTIFIED_KEY)!).length <= 20);
});

test('firstTime: corrupt storage still alerts', () => {
  const store = memory();
  store.map.set(NOTIFIED_KEY, '{oops');
  assert.equal(firstTime(store, 'run_a', 'done'), true);
  assert.equal(firstTime(store, 'run_a', 'done'), false);
});

test('alertsEnabled: on unless switched off', () => {
  const store = memory();
  assert.equal(alertsEnabled(store), true);
  store.map.set('agent.notify', 'off');
  assert.equal(alertsEnabled(store), false);
});
