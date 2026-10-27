import { test } from 'node:test';
import assert from 'node:assert/strict';
import { attentionParams, categoryOf, checkReason, feedView, needsCheck, parseCategory, statusCells, type RunRow } from '../src/lib/updates.ts';

const NOW = Date.parse('2026-10-27T10:00:00Z');
const run = (over: Partial<RunRow>): RunRow => ({
  id: 1,
  job_id: 'j',
  job_name: 'riset-data-persib',
  kind: 'agent',
  status: 'completed',
  started_at: '2026-10-27T09:00:00Z',
  summary: 's',
  error: null,
  ...over,
});

test('categoryOf groups jobs by name and falls back to system', () => {
  assert.equal(categoryOf('riset-data-persib'), 'research');
  assert.equal(categoryOf('riset-match-detail'), 'research');
  assert.equal(categoryOf('ide-konten-persib'), 'research');
  assert.equal(categoryOf('riset-jadwal-persib'), 'schedule');
  assert.equal(categoryOf('riset-klasemen-persib-daily'), 'schedule');
  assert.equal(categoryOf('update-klasemen-berjalan'), 'schedule');
  assert.equal(categoryOf('ui-ux-persib'), 'dev');
  assert.equal(categoryOf('chain-uiux-to-dev'), 'dev');
  assert.equal(categoryOf('dev-persib'), 'dev');
  assert.equal(categoryOf('watchdog-web-persib-cheap'), 'system');
  assert.equal(categoryOf('log-token-harian'), 'system');
  assert.equal(categoryOf('something-new'), 'system');
  assert.equal(categoryOf(null), 'system');
});

test('parseCategory accepts only known keys', () => {
  assert.equal(parseCategory('research'), 'research');
  assert.equal(parseCategory('nope'), 'all');
  assert.equal(parseCategory(null), 'all');
});

test('needsCheck: agent flag stays until checked, a failure only for a week', () => {
  assert.equal(needsCheck(run({ needs_check: true }), NOW), true);
  assert.equal(needsCheck(run({ needs_check: true, checked_at: '2026-10-27T09:30:00Z' }), NOW), false);
  assert.equal(needsCheck(run({ needs_check: true, started_at: '2026-08-01T00:00:00Z' }), NOW), true);
  assert.equal(needsCheck(run({ status: 'failed' }), NOW), true);
  assert.equal(needsCheck(run({ status: 'failed', started_at: '2026-10-01T00:00:00Z' }), NOW), false);
  assert.equal(needsCheck(run({ status: 'failed', checked_at: '2026-10-27T09:30:00Z' }), NOW), false);
  assert.equal(needsCheck(run({ status: 'failed', started_at: null }), NOW), false);
  assert.equal(needsCheck(run({}), NOW), false);
});

test('checkReason prefers the agent text and falls back to the failure', () => {
  assert.equal(checkReason(run({ needs_check: true, check_reason: ' 3 drafts waiting ' })), '3 drafts waiting');
  assert.match(checkReason(run({ needs_check: true, check_reason: null })), /asked you/);
  assert.equal(checkReason(run({ status: 'failed', error: 'timeout' })), 'The run failed: timeout');
  assert.equal(checkReason(run({ status: 'failed' })), 'The run failed');
});

test('attentionParams selects the same runs as needsCheck', () => {
  const p = attentionParams(NOW);
  assert.equal(p['filter[_and][0][checked_at][_null]'], 'true');
  assert.equal(p['filter[_and][1][_or][0][needs_check][_eq]'], 'true');
  assert.equal(p['filter[_and][1][_or][1][_and][0][status][_eq]'], 'failed');
  assert.equal(p['filter[_and][1][_or][1][_and][1][started_at][_gte]'], '2026-10-20T10:00:00.000Z');
});

test('feedView sorts newest first, counts per category and filters', () => {
  const rows = [
    run({ id: 1, started_at: '2026-10-27T01:00:00Z' }),
    run({ id: 2, job_name: 'update-klasemen-berjalan', started_at: '2026-10-27T07:00:00Z' }),
    run({ id: 3, job_name: 'watchdog-web-persib', status: 'failed', started_at: '2026-10-27T08:00:00Z' }),
    run({ id: 4, job_name: 'riset-data-persib', needs_check: true, check_reason: 'x', started_at: '2026-10-26T01:00:00Z' }),
  ];
  const all = feedView(rows, 'all', false, NOW);
  assert.deepEqual(all.items.map((i) => i.run.id), [3, 2, 1, 4]);
  assert.deepEqual(all.counts, { all: 4, research: 2, schedule: 1, dev: 0, system: 1 });
  assert.equal(all.attention, 2);
  assert.deepEqual(feedView(rows, 'research', false, NOW).items.map((i) => i.run.id), [1, 4]);
  assert.deepEqual(feedView(rows, 'all', true, NOW).items.map((i) => i.run.id), [3, 4]);
  // counts do not change with the filter, so the tabs stay stable
  assert.equal(feedView(rows, 'dev', true, NOW).counts.all, 4);
  assert.equal(all.items[0].reason, 'The run failed');
  assert.equal(all.items[1].reason, null);
});

test('statusCells reads the job own last result', () => {
  const cells = statusCells([
    { name: 'watchdog-web-persib', last_status: 'ok', last_run_at: 'a' },
    { name: 'check-deploy-status', last_status: 'error', last_run_at: 'b' },
  ]);
  assert.deepEqual(cells.map((c) => [c.label, c.tone, c.text]), [
    ['Website', 'ok', 'healthy'],
    ['Deploy', 'fail', 'needs a look'],
    ['Anthropic login', 'idle', 'no data'],
  ]);
});
