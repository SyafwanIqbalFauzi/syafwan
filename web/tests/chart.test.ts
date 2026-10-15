import assert from 'node:assert/strict';
import { test } from 'node:test';
import { labelStep, linePath, niceAxis, niceCeil } from '../src/lib/chart.ts';

test('niceCeil: 1, 2, 5 or 10 times a power of ten', () => {
  assert.deepEqual([0.3, 1, 1.1, 2, 3, 5, 6, 9.9, 12, 480, 1_234_567].map(niceCeil), [0.5, 1, 2, 2, 5, 5, 10, 10, 20, 500, 2_000_000]);
  assert.equal(niceCeil(0), 1);
  assert.equal(niceCeil(-5), 1);
});

test('niceAxis: starts at zero for positive data, five evenly spaced ticks', () => {
  const axis = niceAxis(0, 8_522_024);
  assert.deepEqual([axis.min, axis.max], [0, 10_000_000]);
  assert.deepEqual(axis.ticks, [0, 2_500_000, 5_000_000, 7_500_000, 10_000_000]);
});

test('niceAxis: makes room below zero when the running balance goes negative, and keeps zero as a tick', () => {
  const axis = niceAxis(-3_000_000, 12_000_000);
  assert.deepEqual([axis.min, axis.max], [-5_000_000, 15_000_000]);
  assert.deepEqual(axis.ticks, [-5_000_000, 0, 5_000_000, 10_000_000, 15_000_000]);
});

test('niceAxis: empty data still gives a usable axis', () => {
  const axis = niceAxis(0, 0);
  assert.deepEqual([axis.min, axis.max], [0, 1]);
});

test('labelStep and linePath', () => {
  assert.equal(labelStep(7), 1);
  assert.equal(labelStep(30), 4);
  assert.equal(labelStep(12, 12), 1);
  assert.equal(linePath([{ x: 0, y: 10 }, { x: 5.55, y: 2 }]), 'M0.0 10.0 L5.5 2.0');
  assert.equal(linePath([]), '');
});

test('personHex and withAlpha', async () => {
  const { personHex, withAlpha } = await import('../src/lib/chart.ts');
  assert.equal(personHex('income', 0), '#0071bb');
  assert.equal(personHex('expense', 1), '#757575');
  assert.equal(personHex('expense', 9), '#bdbdbd'); // more people than shades: the last shade repeats
  assert.equal(withAlpha('#0071bb', 0.5), 'rgba(0, 113, 187, 0.5)');
});
