import assert from 'node:assert/strict';
import { test } from 'node:test';
import { connectLabel, parseConnect, requestState, safeAuthUrl } from '../src/lib/account-connect.ts';

test('parseConnect: start normalises the address and keeps an optional label', () => {
  assert.deepEqual(parseConnect({ action: 'start', identifier: ' Me@Braga.co.id ', label: ' Work ' }), { ok: true, data: { action: 'start', identifier: 'me@braga.co.id', label: 'Work' } });
  assert.deepEqual(parseConnect({ action: 'start', identifier: 'a@b.co' }), { ok: true, data: { action: 'start', identifier: 'a@b.co', label: null } });
});

test('parseConnect: rejects bad addresses, labels, actions and bodies', () => {
  for (const body of [null, 'x', {}, { action: 'start' }, { action: 'start', identifier: 'nope' }, { action: 'start', identifier: 'a b@c.com' }, { action: 'delete', identifier: 'a@b.co' }]) {
    assert.equal(parseConnect(body).ok, false);
  }
  assert.equal(parseConnect({ action: 'start', identifier: 'a@b.co', label: 'x'.repeat(41) }).ok, false);
  assert.equal(parseConnect({ action: 'start', identifier: 'a@b.co', label: 'a\nb' }).ok, false);
});

test('parseConnect: finish needs a pasted address of sane size', () => {
  const url = 'http://localhost:1/?state=s&code=4/0A';
  assert.deepEqual(parseConnect({ action: 'finish', identifier: 'a@b.co', redirect: ` ${url} ` }), { ok: true, data: { action: 'finish', identifier: 'a@b.co', payload: url } });
  assert.equal(parseConnect({ action: 'finish', identifier: 'a@b.co', redirect: '' }).ok, false);
  assert.equal(parseConnect({ action: 'finish', identifier: 'a@b.co' }).ok, false);
  assert.equal(parseConnect({ action: 'finish', identifier: 'a@b.co', redirect: 'x'.repeat(4001) }).ok, false);
});

test('safeAuthUrl: only Google OAuth links over https', () => {
  const good = 'https://accounts.google.com/o/oauth2/auth?client_id=1&state=s';
  assert.equal(safeAuthUrl(good), good);
  for (const bad of ['javascript:alert(1)', 'http://accounts.google.com/o/oauth2/auth', 'https://accounts.google.com.evil.com/o/oauth2/auth', 'https://evil.com/o/oauth2/auth', 'https://accounts.google.com/signin', 'not a url', null, 5]) {
    assert.equal(safeAuthUrl(bad), null);
  }
});

test('requestState and connectLabel', () => {
  assert.equal(requestState('done'), 'done');
  assert.equal(requestState('failed'), 'failed');
  assert.equal(requestState('pending'), 'waiting');
  assert.equal(requestState(undefined), 'waiting');
  assert.equal(connectLabel('connected'), null);
  assert.equal(connectLabel('not_connected'), 'Connect');
  assert.equal(connectLabel('revoked'), 'Reconnect');
  assert.equal(connectLabel('error'), 'Reconnect');
});
