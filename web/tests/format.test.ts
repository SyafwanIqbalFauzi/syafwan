import assert from 'node:assert/strict';
import { test } from 'node:test';
import { compact, dayKey, duration, formatWhen, modelLabel, relative, usd } from '../src/lib/format.ts';
import { humanizeSchedule } from '../src/lib/schedule.ts';

test('humanizeSchedule: intervals', () => {
  assert.equal(humanizeSchedule('every 30m'), 'every 30 minutes');
  assert.equal(humanizeSchedule('every 60m'), 'every hour');
  assert.equal(humanizeSchedule('every 1m'), 'every minute');
  assert.equal(humanizeSchedule('every 5256000m'), 'on demand (no repeat)');
  assert.equal(humanizeSchedule('*/10 * * * *'), 'every 10 minutes');
});

test('humanizeSchedule: daily and hourly cron in WIB', () => {
  assert.equal(humanizeSchedule('0 0 * * *'), 'every day at 07:00 WIB');
  assert.equal(humanizeSchedule('0 1,7,13,19 * * *'), 'every day at 02:00, 08:00, 14:00, 20:00 WIB');
  assert.equal(humanizeSchedule('0 * * * *'), 'every hour, on the hour');
  assert.equal(humanizeSchedule('20 * * * *'), 'every hour at minute 20');
});

test('humanizeSchedule: weekday moves when WIB crosses midnight', () => {
  assert.equal(humanizeSchedule('0 12 * * 0'), 'every Sunday at 19:00 WIB');
  assert.equal(humanizeSchedule('0 2 * * 1'), 'every Monday at 09:00 WIB');
  assert.equal(humanizeSchedule('0 22 * * 5'), 'every Saturday at 05:00 WIB');
  assert.equal(humanizeSchedule('0 20 * * 6'), 'every Sunday at 03:00 WIB');
});

test('humanizeSchedule: falls back to the raw text for anything it does not understand', () => {
  assert.equal(humanizeSchedule('0 0 1 1 *'), '0 0 1 1 *');
  assert.equal(humanizeSchedule('@weekly'), '@weekly');
  assert.equal(humanizeSchedule(''), 'not scheduled');
  assert.equal(humanizeSchedule(null), 'not scheduled');
});

test('format helpers', () => {
  assert.equal(formatWhen('2026-10-15T04:00:00Z'), '15 Oct 11:00');
  assert.equal(formatWhen(null), '—');
  assert.equal(dayKey('2026-10-14T20:00:00Z'), '2026-10-15'); // 03:00 WIB next day
  assert.equal(duration(0.4), '<1 s');
  assert.equal(duration(95), '1 min 35 s');
  assert.equal(compact(21714), '22k');
  assert.equal(compact(5_841_816), '5.84M');
  assert.equal(usd(0.055048), '$0.055');
  assert.equal(modelLabel('claude-sonnet-5-5'), 'sonnet-5.5');
  assert.equal(modelLabel(null), 'default');
});

test('relative time', () => {
  const now = Date.parse('2026-10-15T04:00:00Z');
  assert.equal(relative('2026-10-15T03:57:00Z', now), '3 min ago');
  assert.equal(relative('2026-10-15T06:00:00Z', now), 'in 2 h');
  assert.equal(relative('2026-10-13T04:00:00Z', now), '2 d ago');
});
