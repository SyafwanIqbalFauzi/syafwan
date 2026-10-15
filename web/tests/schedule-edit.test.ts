import assert from 'node:assert/strict';
import { test } from 'node:test';
import { humanizeSchedule } from '../src/lib/schedule.ts';
import { buildSchedule, normalizeJobName, parseScheduleForm, validateSchedule, type ScheduleForm } from '../src/lib/schedule-edit.ts';

test('build: WIB times become UTC cron', () => {
  assert.equal(buildSchedule({ mode: 'daily', time: '07:00' }), '0 0 * * *');
  assert.equal(buildSchedule({ mode: 'daily', time: '08:30' }), '30 1 * * *');
  assert.equal(buildSchedule({ mode: 'daily', time: '02:00' }), '0 19 * * *');
  assert.equal(buildSchedule({ mode: 'daily', time: '00:00' }), '0 17 * * *');
});

test('build: weekly moves to the previous UTC day before 07:00 WIB', () => {
  assert.equal(buildSchedule({ mode: 'weekly', weekday: 0, time: '19:00' }), '0 12 * * 0'); // Sunday 19:00 WIB
  assert.equal(buildSchedule({ mode: 'weekly', weekday: 1, time: '09:00' }), '0 2 * * 1'); // Monday 09:00 WIB
  assert.equal(buildSchedule({ mode: 'weekly', weekday: 6, time: '05:00' }), '0 22 * * 5'); // Saturday 05:00 WIB = Friday 22:00 UTC
  assert.equal(buildSchedule({ mode: 'weekly', weekday: 0, time: '03:00' }), '0 20 * * 6'); // Sunday 03:00 WIB = Saturday 20:00 UTC
});

test('build: interval, hourly, custom and invalid input', () => {
  assert.equal(buildSchedule({ mode: 'interval', minutes: 30 }), 'every 30m');
  assert.equal(buildSchedule({ mode: 'interval', minutes: 0 }), null);
  assert.equal(buildSchedule({ mode: 'interval', minutes: 1441 }), null);
  assert.equal(buildSchedule({ mode: 'interval', minutes: 2.5 }), null);
  assert.equal(buildSchedule({ mode: 'hourly', minute: 20 }), '20 * * * *');
  assert.equal(buildSchedule({ mode: 'hourly', minute: 60 }), null);
  assert.equal(buildSchedule({ mode: 'daily', time: '25:00' }), null);
  assert.equal(buildSchedule({ mode: 'daily', time: '7' }), null);
  assert.equal(buildSchedule({ mode: 'weekly', weekday: 7, time: '08:00' }), null);
  assert.equal(buildSchedule({ mode: 'custom', raw: ' 0 1,7,13,19 * * * ' }), '0 1,7,13,19 * * *');
  assert.equal(buildSchedule({ mode: 'custom', raw: 'rm -rf /' }), null);
});

test('validateSchedule accepts real cron and rejects out-of-range or odd input', () => {
  for (const ok of ['0 0 * * *', '*/10 * * * *', '0 1,7,13,19 * * *', '0 0 1 1 *', '5-30/5 * * * 1-5', 'every 5m', 'every 5256000m']) assert.ok(validateSchedule(ok), ok);
  for (const bad of ['', '* * * *', '61 * * * *', '0 24 * * *', '0 0 0 * *', '0 0 * 13 *', '0 0 * * 8', '*/0 * * * *', 'every 0m', 'every m', '0 0 * * * *', 'a b c d e', '0 0 * * *; ls']) assert.ok(!validateSchedule(bad), bad);
});

test('parse is the inverse of build for friendly modes', () => {
  const forms: ScheduleForm[] = [
    { mode: 'daily', time: '07:00' },
    { mode: 'daily', time: '02:15' },
    { mode: 'daily', time: '23:59' },
    { mode: 'weekly', weekday: 0, time: '19:00' },
    { mode: 'weekly', weekday: 6, time: '05:00' },
    { mode: 'weekly', weekday: 0, time: '03:00' },
    { mode: 'weekly', weekday: 3, time: '12:30' },
    { mode: 'hourly', minute: 20 },
    { mode: 'interval', minutes: 45 },
  ];
  for (const form of forms) {
    const built = buildSchedule(form)!;
    assert.deepEqual(parseScheduleForm(built), form, `${JSON.stringify(form)} -> ${built}`);
  }
});

test('parse: existing jobs land in the right mode', () => {
  assert.deepEqual(parseScheduleForm('0 0 * * *'), { mode: 'daily', time: '07:00' });
  assert.deepEqual(parseScheduleForm('0 22 * * 5'), { mode: 'weekly', weekday: 6, time: '05:00' });
  assert.deepEqual(parseScheduleForm('*/10 * * * *'), { mode: 'interval', minutes: 10 });
  assert.deepEqual(parseScheduleForm('every 60m'), { mode: 'interval', minutes: 60 });
  assert.deepEqual(parseScheduleForm('0 1,7,13,19 * * *'), { mode: 'custom', raw: '0 1,7,13,19 * * *' });
  assert.deepEqual(parseScheduleForm('0 0 1 1 *'), { mode: 'custom', raw: '0 0 1 1 *' });
  assert.deepEqual(parseScheduleForm('every 5256000m'), { mode: 'custom', raw: 'every 5256000m' });
  assert.deepEqual(parseScheduleForm(null), { mode: 'custom', raw: '' });
});

test('the preview text agrees with the form for every friendly mode', () => {
  assert.equal(humanizeSchedule(buildSchedule({ mode: 'daily', time: '07:00' })), 'every day at 07:00 WIB');
  assert.equal(humanizeSchedule(buildSchedule({ mode: 'weekly', weekday: 6, time: '05:00' })), 'every Saturday at 05:00 WIB');
  assert.equal(humanizeSchedule(buildSchedule({ mode: 'weekly', weekday: 0, time: '19:00' })), 'every Sunday at 19:00 WIB');
  assert.equal(humanizeSchedule(buildSchedule({ mode: 'interval', minutes: 30 })), 'every 30 minutes');
});

test('job names', () => {
  assert.equal(normalizeJobName('  monitoring   jadwal '), 'monitoring jadwal');
  assert.equal(normalizeJobName(''), null);
  assert.equal(normalizeJobName('x'.repeat(81)), null);
  assert.equal(normalizeJobName('a\nb'), 'a b');
  assert.equal(normalizeJobName('<b>x</b>'), null);
  assert.equal(normalizeJobName(5), null);
});
