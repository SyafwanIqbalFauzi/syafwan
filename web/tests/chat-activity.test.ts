import assert from 'node:assert/strict';
import { test } from 'node:test';
import { describeActivity, isWaitingForPerson, nextActivity, STALL_AFTER_S, type Activity } from '../src/lib/chat-activity.ts';

const run = (events: [string, Record<string, any>?][], start: Activity = { phase: 'thinking' }) =>
  events.reduce((a, [name, data]) => nextActivity(a, name, data ?? {}), start);

test('a normal turn: thinking, then writing', () => {
  assert.equal(run([['run.started'], ['message.started']]).phase, 'thinking');
  assert.equal(run([['run.started'], ['assistant.delta']]).phase, 'writing');
  const writing = run([['assistant.delta']]);
  assert.equal(nextActivity(writing, 'assistant.delta'), writing); // no churn while text streams in
});

test('tool use shows the tool and a short preview, then goes back to thinking', () => {
  const tool = run([['tool.started', { tool_name: 'terminal', preview: 'ls   -la\n/home/user' }]]);
  assert.deepEqual(tool, { phase: 'tool', tool: 'terminal', detail: 'ls -la /home/user' });
  assert.equal(describeActivity(tool), 'Using terminal: ls -la /home/user');
  assert.equal(run([['tool.started', { tool_name: 'x' }], ['tool.completed', { tool_name: 'x' }]]).phase, 'thinking');
  assert.equal(run([['tool.started', { tool_name: 'x' }], ['tool.failed', { tool_name: 'x' }]]).phase, 'thinking');
});

test('long previews are cut and missing names fall back', () => {
  const tool = run([['tool.started', { tool_name: 'terminal', preview: 'x'.repeat(300) }]]);
  assert.ok((tool.detail ?? '').length <= 90);
  assert.ok((tool.detail ?? '').endsWith('…'));
  assert.equal(run([['tool.started', {}]]).tool, 'a tool');
  assert.equal(describeActivity({ phase: 'tool', tool: 'web_search' }), 'Using web_search');
});

test('approval waits for the person and resumes after the answer', () => {
  const waiting = run([['tool.started', { tool_name: 'terminal' }], ['approval.request']]);
  assert.equal(waiting.phase, 'approval');
  assert.equal(describeActivity(waiting, 999), 'Waiting for your approval'); // never "still working" while it waits for you
  assert.ok(isWaitingForPerson(waiting));
  assert.equal(nextActivity(waiting, 'approval.answered').phase, 'thinking');
  assert.ok(!isWaitingForPerson({ phase: 'thinking' }));
});

test('reasoning progress does not hide a running tool or a pending approval', () => {
  const tool: Activity = { phase: 'tool', tool: 'terminal' };
  assert.equal(nextActivity(tool, 'tool.progress', { tool_name: '_thinking' }), tool);
  const approval: Activity = { phase: 'approval' };
  assert.equal(nextActivity(approval, 'tool.progress', {}), approval);
  assert.equal(nextActivity({ phase: 'writing' }, 'tool.progress', {}).phase, 'thinking');
});

test('stopping is sticky until the run ends', () => {
  const stopping = run([['assistant.delta'], ['stop.requested']]);
  assert.equal(stopping.phase, 'stopping');
  assert.equal(nextActivity(stopping, 'assistant.delta'), stopping);
  assert.equal(describeActivity(stopping), 'Stopping…');
});

test('a long silence is called out, but only after the threshold', () => {
  assert.equal(describeActivity({ phase: 'thinking' }, STALL_AFTER_S - 1), 'Hermes is thinking…');
  assert.match(describeActivity({ phase: 'thinking' }, STALL_AFTER_S + 4), /still working, nothing new for 34 s$/);
  assert.match(describeActivity({ phase: 'writing' }, 45), /^Hermes is writing…/);
});

test('unknown events change nothing', () => {
  const a: Activity = { phase: 'writing' };
  assert.equal(nextActivity(a, 'run.completed'), a);
  assert.equal(nextActivity(a, 'something.new'), a);
});

test('Runs API event names drive the same states', () => {
  assert.equal(run([['message.delta', { delta: 'Hi' }]]).phase, 'writing');
  const tool = run([['tool.started', { tool: 'terminal', preview: 'echo hi' }]]);
  assert.deepEqual(tool, { phase: 'tool', tool: 'terminal', detail: 'echo hi' });
  assert.equal(nextActivity(tool, 'tool.completed', { tool: 'terminal', error: false }).phase, 'thinking');
  const waiting = run([['tool.started', { tool: 'terminal' }], ['approval.request']]);
  assert.equal(nextActivity(waiting, 'approval.responded', { choice: 'deny' }).phase, 'thinking');
  // reasoning text never hides a running tool or a pending approval
  assert.equal(nextActivity(tool, 'reasoning.available', { text: '…' }), tool);
  assert.equal(nextActivity(waiting, 'reasoning.available', { text: '…' }), waiting);
  assert.equal(nextActivity({ phase: 'writing' }, 'reasoning.available', {}).phase, 'thinking');
});
