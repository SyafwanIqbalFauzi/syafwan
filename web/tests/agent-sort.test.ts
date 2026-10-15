import assert from 'node:assert/strict';
import { test } from 'node:test';
import { compareJobs, parseSort, type SortableJob } from '../src/lib/agent-sort.ts';

const job = (name: string, over: Partial<SortableJob> = {}): SortableJob => ({
  name,
  state: 'active',
  next_run_at: null,
  last_run_at: null,
  failing: false,
  ...over,
});
const order = (sort: Parameters<typeof compareJobs>[0], jobs: SortableJob[]) => [...jobs].sort((a, b) => compareJobs(sort, a, b)).map((j) => j.name);

test('parseSort accepts only known keys', () => {
  assert.equal(parseSort('name'), 'name');
  assert.equal(parseSort('failing'), 'failing');
  assert.equal(parseSort('drop table'), null);
  assert.equal(parseSort(null), null);
  assert.equal(parseSort(''), null);
});

test('name sorts, case-insensitively, both ways', () => {
  const jobs = [job('beta'), job('Alpha'), job('gamma')];
  assert.deepEqual(order('name', jobs), ['Alpha', 'beta', 'gamma']);
  assert.deepEqual(order('name_desc', jobs), ['gamma', 'beta', 'Alpha']);
});

test('next run: soonest first, jobs without one last', () => {
  const jobs = [job('none'), job('late', { next_run_at: '2026-10-20T00:00:00Z' }), job('soon', { next_run_at: '2026-10-16T00:00:00Z' })];
  assert.deepEqual(order('next', jobs), ['soon', 'late', 'none']);
});

test('last run: newest or oldest first, never-run jobs always last', () => {
  const jobs = [job('never'), job('old', { last_run_at: '2026-10-01T00:00:00Z' }), job('new', { last_run_at: '2026-10-14T00:00:00Z' })];
  assert.deepEqual(order('last', jobs), ['new', 'old', 'never']);
  assert.deepEqual(order('last_old', jobs), ['old', 'new', 'never']);
});

test('failing first, then most recent', () => {
  const jobs = [job('fine'), job('bad-old', { failing: true, last_run_at: '2026-10-01T00:00:00Z' }), job('bad-new', { failing: true, last_run_at: '2026-10-14T00:00:00Z' })];
  assert.deepEqual(order('failing', jobs), ['bad-new', 'bad-old', 'fine']);
});

test('default order: active, paused, done; soonest first inside a state', () => {
  const jobs = [
    job('done', { state: 'done' }),
    job('paused', { state: 'paused' }),
    job('active-late', { next_run_at: '2026-10-20T00:00:00Z' }),
    job('active-soon', { next_run_at: '2026-10-16T00:00:00Z' }),
  ];
  assert.deepEqual(order(null, jobs), ['active-soon', 'active-late', 'paused', 'done']);
});
