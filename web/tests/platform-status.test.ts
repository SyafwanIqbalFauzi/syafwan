import test from 'node:test';
import assert from 'node:assert/strict';
import { platformStates } from '../src/lib/platform-status.ts';

test('platformStates: an entry written by the running gateway keeps its state', () => {
  const out = platformStates({ telegram: { state: 'connected', writer_pid: 10 } }, 10);
  assert.deepEqual(out, [['telegram', 'connected']]);
});

test('platformStates: a "connected" entry left by an old process is not running', () => {
  const out = platformStates(
    { telegram: { state: 'connected', writer_pid: 10 }, discord: { state: 'connected', writer_pid: 7 } },
    10,
  );
  assert.deepEqual(out, [['telegram', 'connected'], ['discord', 'not running']]);
});

test('platformStates: other states stay as they are, even from an old process', () => {
  assert.deepEqual(platformStates({ discord: { state: 'fatal', writer_pid: 7 } }, 10), [['discord', 'fatal']]);
});

test('platformStates: without a gateway pid or writer pid nothing is judged stale', () => {
  assert.deepEqual(platformStates({ a: { state: 'connected', writer_pid: 7 } }, undefined), [['a', 'connected']]);
  assert.deepEqual(platformStates({ a: { state: 'connected' } }, 10), [['a', 'connected']]);
});

test('platformStates: missing input and missing state', () => {
  assert.deepEqual(platformStates(undefined, 10), []);
  assert.deepEqual(platformStates({ a: null }, 10), [['a', 'unknown']]);
});
