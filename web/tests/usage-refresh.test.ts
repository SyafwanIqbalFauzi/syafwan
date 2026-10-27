import assert from 'node:assert/strict';
import { test } from 'node:test';
import { findSyncJobId, isNewer, latestCheckedAt } from '../src/lib/usage-refresh.ts';

test('findSyncJobId: by name, array or {jobs}, ignores others and bad ids', () => {
  assert.equal(findSyncJobId([{ id: 'bbb', name: 'sync-accounts' }, { id: 'aaa', name: 'sync-claude-usage' }], 'sync-accounts'), 'bbb');
  const jobs = [{ id: 'aaa', name: 'other' }, { id: '78dde941faea', name: 'sync-claude-usage' }];
  assert.equal(findSyncJobId(jobs), '78dde941faea');
  assert.equal(findSyncJobId({ jobs }), '78dde941faea');
  assert.equal(findSyncJobId({ jobs: [{ id: 'aaa', name: 'x' }] }), null);
  assert.equal(findSyncJobId({ jobs: [{ id: '../x', name: 'sync-claude-usage' }] }), null);
  assert.equal(findSyncJobId(null), null);
});

test('latestCheckedAt: newest valid timestamp', () => {
  assert.equal(latestCheckedAt([{ checked_at: '2026-10-27T03:00:00.000Z' }, { checked_at: null }, { checked_at: '2026-10-27T03:05:00.000Z' }]), '2026-10-27T03:05:00.000Z');
  assert.equal(latestCheckedAt([]), null);
});

test('isNewer: strictly later, or any value when there was none', () => {
  assert.equal(isNewer('2026-10-27T03:00:00Z', '2026-10-27T03:05:00Z'), true);
  assert.equal(isNewer('2026-10-27T03:05:00Z', '2026-10-27T03:05:00Z'), false);
  assert.equal(isNewer(null, '2026-10-27T03:05:00Z'), true);
  assert.equal(isNewer('2026-10-27T03:05:00Z', null), false);
});
