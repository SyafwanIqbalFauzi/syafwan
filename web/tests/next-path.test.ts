import assert from 'node:assert/strict';
import { test } from 'node:test';
import { safeNext } from '../src/lib/next-path.ts';

test('private pages of this site are allowed', () => {
  for (const ok of ['/agent', '/agent/chat', '/agent/agents/abc-123', '/finance', '/finance/transactions', '/finance/budgets']) assert.equal(safeNext(ok), ok);
});

test('everything else goes to the agent overview', () => {
  const bad = ['https://evil.example', '//evil.example', '/\\evil.example', 'javascript:alert(1)', '/agent/../x', '/agent?x=1', '/agentx', '/financex', '/api/finance/budgets', '/en', '', ' /agent', '/agent/ok\n', '/agent/login', '/agent/logout', null, undefined, 5, {}, '/finance/' + 'a'.repeat(300)];
  for (const value of bad) assert.equal(safeNext(value), '/agent', String(value));
});
