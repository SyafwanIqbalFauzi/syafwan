import assert from 'node:assert/strict';
import { test } from 'node:test';
import { levelFor, resetsIn, usageView, type UsageRow } from '../src/lib/claude-usage.ts';

const NOW = Date.parse('2026-10-15T08:00:00Z');
const row = (over: Partial<UsageRow> = {}): UsageRow => ({ window: 'session', percent: 80, severity: 'warning', resets_at: '2026-10-15T10:00:00Z', checked_at: '2026-10-15T07:58:00Z', ...over });

test('levelFor: warning from 75, critical from 90', () => {
  assert.deepEqual([0, 74.9, 75, 89.9, 90, 100].map(levelFor), ['normal', 'normal', 'warning', 'warning', 'critical', 'critical']);
});

test('resetsIn: minutes, hours, days, now', () => {
  assert.equal(resetsIn('2026-10-15T08:05:00Z', NOW), 'in 5 min');
  assert.equal(resetsIn('2026-10-15T10:13:00Z', NOW), 'in 2 h 13 min');
  assert.equal(resetsIn('2026-10-18T09:00:00Z', NOW), 'in 3 d 1 h');
  assert.equal(resetsIn('2026-10-15T07:00:00Z', NOW), 'now');
  assert.equal(resetsIn(null, NOW), null);
  assert.equal(resetsIn('garbage', NOW), null);
});

test('usageView: nothing to show without usable rows', () => {
  assert.equal(usageView(null, NOW), null);
  assert.equal(usageView([], NOW), null);
  assert.equal(usageView([row({ percent: null })], NOW), null);
});

test('usageView: known windows come in a fixed order with readable labels', () => {
  const view = usageView([row({ window: 'weekly', percent: 54 }), row({ window: 'mystery_window', percent: 1 }), row()], NOW)!;
  assert.deepEqual(view.windows.map((w) => w.key), ['session', 'weekly', 'mystery_window']);
  assert.deepEqual(view.windows.map((w) => w.label), ['5-hour window', 'Weekly · all models', 'mystery window']);
  assert.equal(view.windows[0].level, 'warning');
  assert.equal(view.windows[0].resetsIn, 'in 2 h 0 min');
  assert.equal(view.stale, false);
});

test('usageView: the level comes from the percent, not from the stored severity', () => {
  const view = usageView([row({ percent: 95, severity: 'normal' })], NOW)!;
  assert.equal(view.windows[0].level, 'critical');
});

test('usageView: percent is clamped; a passed reset time is flagged', () => {
  const view = usageView([row({ percent: 130, resets_at: '2026-10-15T07:00:00Z' })], NOW)!;
  assert.equal(view.windows[0].percent, 100);
  assert.equal(view.windows[0].rolledOver, true);
});

test('usageView: old or missing check time means stale', () => {
  assert.equal(usageView([row({ checked_at: '2026-10-15T07:30:00Z' })], NOW)!.stale, true);
  assert.equal(usageView([row({ checked_at: null })], NOW)!.stale, true);
  assert.equal(usageView([row({ checked_at: '2026-10-15T07:45:00Z' })], NOW)!.stale, false);
});
