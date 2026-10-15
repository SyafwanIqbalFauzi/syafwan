import assert from 'node:assert/strict';
import { test } from 'node:test';
import { resolveHermesRoute } from '../src/lib/hermes-routes.ts';
import { RateLimiter } from '../src/lib/ratelimit.ts';
import { SseParser } from '../src/lib/sse.ts';

test('route allowlist maps known endpoints', () => {
  assert.deepEqual(resolveHermesRoute('GET', 'sessions'), { target: '/api/sessions', stream: false, render: false });
  assert.deepEqual(resolveHermesRoute('POST', 'sessions/abc-1/chat/stream'), {
    target: '/api/sessions/abc-1/chat/stream',
    stream: true,
    render: false,
  });
  assert.deepEqual(resolveHermesRoute('GET', 'sessions/abc-1/messages'), {
    target: '/api/sessions/abc-1/messages',
    stream: false,
    render: true,
  });
  assert.equal(resolveHermesRoute('POST', 'runs/run_ab12/stop')?.target, '/v1/runs/run_ab12/stop');
  assert.equal(resolveHermesRoute('POST', 'jobs/j1/pause')?.target, '/api/jobs/j1/pause');
  assert.equal(resolveHermesRoute('get', 'models')?.target, '/api/model/options');
});

test('runs can be read, watched, stopped and answered, but not started through the proxy', () => {
  assert.deepEqual(resolveHermesRoute('GET', 'runs/run_ab12'), { target: '/v1/runs/run_ab12', stream: false, render: false });
  assert.deepEqual(resolveHermesRoute('GET', 'runs/run_ab12/events'), { target: '/v1/runs/run_ab12/events', stream: true, render: false });
  assert.equal(resolveHermesRoute('POST', 'runs/run_ab12/stop')?.target, '/v1/runs/run_ab12/stop');
  assert.equal(resolveHermesRoute('POST', 'runs/run_ab12/approval')?.target, '/v1/runs/run_ab12/approval');
  assert.equal(resolveHermesRoute('POST', 'runs'), null); // started only by the validated route
  assert.equal(resolveHermesRoute('DELETE', 'runs/run_ab12'), null);
});

test('route allowlist rejects everything else', () => {
  assert.equal(resolveHermesRoute('GET', 'v1/chat/completions'), null);
  assert.equal(resolveHermesRoute('DELETE', 'sessions'), null);
  assert.equal(resolveHermesRoute('GET', 'sessions/'), null);
  assert.equal(resolveHermesRoute('POST', 'jobs/j1/explode'), null);
  assert.equal(resolveHermesRoute('GET', 'config'), null);
  // Editing/creating jobs is not proxied: it goes through validated routes instead.
  assert.equal(resolveHermesRoute('PATCH', 'jobs/j1'), null);
  assert.equal(resolveHermesRoute('POST', 'jobs'), null);
});

test('route allowlist blocks path tricks in ids', () => {
  assert.equal(resolveHermesRoute('GET', 'sessions/../../etc/passwd'), null);
  assert.equal(resolveHermesRoute('GET', 'sessions/a/b'), null);
  assert.equal(resolveHermesRoute('GET', 'sessions/a%2Fb'), null);
  assert.equal(resolveHermesRoute('GET', `sessions/${'x'.repeat(129)}`), null);
  assert.equal(resolveHermesRoute('POST', 'runs/x?y=1/stop'), null);
});

test('rate limiter allows up to the limit then blocks, per key', () => {
  const rl = new RateLimiter(3, 60_000);
  assert.ok(rl.take('a', 0));
  assert.ok(rl.take('a', 1));
  assert.ok(rl.take('a', 2));
  assert.equal(rl.take('a', 3), false);
  assert.ok(rl.take('b', 3));
});

test('rate limiter window slides and reset clears', () => {
  const rl = new RateLimiter(2, 1000);
  assert.ok(rl.take('a', 0));
  assert.ok(rl.take('a', 10));
  assert.equal(rl.take('a', 500), false);
  assert.ok(rl.take('a', 1100));
  rl.reset('a');
  assert.ok(rl.take('a', 1101));
  assert.ok(rl.take('a', 1102));
});

test('SSE parser handles split chunks, comments and multi-line data', () => {
  const p = new SseParser();
  assert.deepEqual(p.push('event: assistant.delta\ndata: {"delta":"He'), []);
  assert.deepEqual(p.push('llo"}\n\n: keepalive\n\nevent: done\r\ndata: {}\r\n\r\n'), [
    { event: 'assistant.delta', data: '{"delta":"Hello"}' },
    { event: 'done', data: '{}' },
  ]);
  assert.deepEqual(p.push('data: a\ndata: b\n\n'), [{ event: 'message', data: 'a\nb' }]);
});
