import assert from 'node:assert/strict';
import { test } from 'node:test';
import { accountsView, accountView, providerLabel, shortScope, type AccountRow } from '../src/lib/accounts.ts';

const NOW = Date.parse('2026-10-27T07:00:00.000Z');
const row = (over: Partial<AccountRow> = {}): AccountRow => ({
  id: 1,
  provider: 'google',
  identifier: 'a@gmail.com',
  label: 'Main',
  status: 'connected',
  scopes: ['https://www.googleapis.com/auth/gmail.send', 'https://www.googleapis.com/auth/calendar'],
  detail: null,
  checked_at: '2026-10-27T06:50:00.000Z',
  last_ok_at: '2026-10-27T06:50:00.000Z',
  ...over,
});

test('shortScope and providerLabel', () => {
  assert.equal(shortScope('https://www.googleapis.com/auth/gmail.send'), 'gmail.send');
  assert.equal(shortScope('instagram_basic'), 'instagram_basic');
  assert.equal(providerLabel('google'), 'Google');
  assert.equal(providerLabel('instagram'), 'Instagram');
});

test('accountView: connected and fresh', () => {
  const v = accountView(row(), NOW);
  assert.equal(v.statusLabel, 'Connected');
  assert.equal(v.tone, 'ok');
  assert.equal(v.needsAction, false);
  assert.equal(v.stale, false);
  assert.deepEqual(v.scopes, ['calendar', 'gmail.send']);
});

test('accountView: connected but not checked for a long time is stale', () => {
  assert.equal(accountView(row({ checked_at: '2026-10-27T04:00:00.000Z' }), NOW).stale, true);
  assert.equal(accountView(row({ checked_at: null }), NOW).stale, true);
  assert.equal(accountView(row({ status: 'revoked', checked_at: '2026-10-27T04:00:00.000Z' }), NOW).stale, false);
});

test('accountView: statuses that need a person', () => {
  assert.deepEqual(['revoked', 'mismatch', 'not_connected'].map((s) => accountView(row({ status: s }), NOW).needsAction), [true, true, true]);
  // a failed check (network) is a problem to look at but nothing to reconnect
  const err = accountView(row({ status: 'error' }), NOW);
  assert.equal(err.needsAction, false);
  assert.equal(err.tone, 'fail');
  // an unknown status is shown as a problem, not hidden
  assert.equal(accountView(row({ status: 'weird' }), NOW).tone, 'fail');
});

test('accountView: missing label falls back to the address, null scopes are empty', () => {
  const v = accountView(row({ label: null, scopes: null }), NOW);
  assert.equal(v.label, 'a@gmail.com');
  assert.deepEqual(v.scopes, []);
});

test('accountsView: problems first, counts, latest check', () => {
  const view = accountsView(
    [
      row({ id: 1, label: 'Main' }),
      row({ id: 2, label: 'Work', status: 'revoked', checked_at: '2026-10-27T06:55:00.000Z' }),
      row({ id: 3, label: 'Persib', status: 'not_connected', checked_at: null }),
    ],
    NOW,
  );
  // the two problems first (by label: Persib, Work), the healthy account last
  assert.deepEqual(view.accounts.map((a) => a.id), [3, 2, 1]);
  assert.equal(view.connected, 1);
  assert.equal(view.needAction, 2);
  assert.equal(view.checkedAt, '2026-10-27T06:55:00.000Z');
  assert.deepEqual(accountsView(null, NOW), { accounts: [], connected: 0, needAction: 0, checkedAt: null });
});
