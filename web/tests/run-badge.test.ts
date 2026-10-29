import assert from 'node:assert/strict';
import { test } from 'node:test';
import { attentionCount, markerText, stateOf, summarize } from '../src/lib/run-badge.ts';

test('stateOf: approval = wait, finished = done, anything else = busy', () => {
  assert.equal(stateOf('waiting_for_approval'), 'wait');
  for (const s of ['completed', 'failed', 'cancelled', 'interrupted']) assert.equal(stateOf(s), 'done', s);
  for (const s of ['running', 'queued', 'started', 'whatever', '', null, undefined]) assert.equal(stateOf(s), 'busy', String(s));
});

test('summarize: nothing, then needs you > working > done, with counts', () => {
  assert.equal(summarize([]), null);
  assert.deepEqual(summarize(['busy']), { state: 'busy', text: 'working' });
  assert.deepEqual(summarize(['busy', 'busy', 'done']), { state: 'busy', text: '2 working' });
  assert.deepEqual(summarize(['busy', 'wait', 'done']), { state: 'wait', text: 'needs you' });
  assert.deepEqual(summarize(['wait', 'wait']), { state: 'wait', text: '2 need you' });
  assert.deepEqual(summarize(['done']), { state: 'done', text: 'done' });
  assert.deepEqual(summarize(['done', 'done', 'done']), { state: 'done', text: '3 done' });
});

test('attentionCount: needs-you and done count, working does not', () => {
  assert.equal(attentionCount([]), 0);
  assert.equal(attentionCount(['busy', 'busy']), 0);
  assert.equal(attentionCount(['busy', 'wait', 'done', 'done']), 3);
});

test('markerText', () => {
  assert.equal(markerText('wait'), 'needs you');
  assert.equal(markerText('busy'), 'working');
  assert.equal(markerText('done'), 'done');
});
