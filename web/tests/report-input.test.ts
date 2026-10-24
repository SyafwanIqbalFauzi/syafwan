import assert from 'node:assert/strict';
import { test } from 'node:test';
import { normalizeSite, parseReport } from '../src/lib/report-input.ts';

test('normalizeSite: reduces a pasted address to the host; refuses things that are not a host', () => {
  assert.equal(normalizeSite('https://www.Example.com/path?x=1#y'), 'example.com');
  assert.equal(normalizeSite('news.example:8080'), 'news.example');
  assert.equal(normalizeSite('  '), null);
  assert.equal(normalizeSite(undefined), null);
  for (const bad of ['a b', '<script>', 'exa mple.com', '-bad.com', 'a'.repeat(254) + '.com', 5]) assert.equal(normalizeSite(bad), false, String(bad));
});

test('parseReport: a normal report passes and is cleaned', () => {
  const r = parseReport({ kind: 'site_bug', site: 'https://News.Example/a', version: '0.1.0', message: ' The video never plays \r\n after I click ', email: ' me@example.com ', lang: 'id', website: '' });
  assert.deepEqual(r, { ok: true, value: { kind: 'site_bug', site: 'news.example', version: '0.1.0', message: 'The video never plays \n after I click', email: 'me@example.com', lang: 'id' } });
});

test('parseReport: site, version and email are optional; language defaults to en', () => {
  const r = parseReport({ kind: 'question', message: 'Does this work on Edge?' });
  assert.deepEqual(r, { ok: true, value: { kind: 'question', site: null, version: null, message: 'Does this work on Edge?', email: null, lang: 'en' } });
});

test('parseReport: refuses an unknown kind, a short or long message, a bad email, a bad site', () => {
  const ok = { kind: 'privacy', message: 'Please delete my report' };
  assert.equal(parseReport({ ...ok, kind: 'spam' }).ok, false);
  assert.equal(parseReport({ ...ok, kind: undefined }).ok, false);
  assert.equal(parseReport({ ...ok, message: 'hey' }).ok, false);
  assert.equal(parseReport({ ...ok, message: 'x'.repeat(2001) }).ok, false);
  assert.equal(parseReport({ ...ok, message: 5 }).ok, false);
  assert.equal(parseReport({ ...ok, email: 'not-an-email' }).ok, false);
  assert.equal(parseReport({ ...ok, site: 'a b' }).ok, false);
  assert.equal(parseReport(null).ok, false);
  assert.equal(parseReport({ ...ok, message: 'x'.repeat(2000) }).ok, true);
});

test('parseReport: control characters are dropped; a bad version is ignored', () => {
  const r = parseReport({ kind: 'question', message: 'hello\u0000 world\u0007!', version: '1.2.3.4.5' });
  assert.equal(r.ok && r.value.message, 'hello world!');
  assert.equal(r.ok && r.value.version, null);
});

test('parseReport: a filled honeypot is flagged as a bot', () => {
  const r = parseReport({ kind: 'question', message: 'Buy cheap watches', website: 'http://spam.example' });
  assert.deepEqual(r, { ok: false, error: 'Rejected', bot: true });
});
