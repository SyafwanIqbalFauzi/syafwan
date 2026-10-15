import assert from 'node:assert/strict';
import { test } from 'node:test';
import { normalizeGroup, orderGroups, UNGROUPED } from '../src/lib/groups.ts';

test('normalizeGroup trims and collapses whitespace', () => {
  assert.equal(normalizeGroup('  Sejarah   Persib '), 'Sejarah Persib');
  assert.equal(normalizeGroup('Hermes & sistem'), 'Hermes & sistem');
});

test('normalizeGroup rejects empty, long, markup and control characters', () => {
  assert.equal(normalizeGroup('   '), null);
  assert.equal(normalizeGroup(''), null);
  assert.equal(normalizeGroup('x'.repeat(41)), null);
  assert.equal(normalizeGroup('<script>'), null);
  assert.equal(normalizeGroup('a\u0000b'), null);
  assert.equal(normalizeGroup(42), null);
  assert.equal(normalizeGroup(null), null);
});

test('orderGroups puts the known groups first, others alphabetical, ungrouped last', () => {
  assert.deepEqual(orderGroups(['Zeta', UNGROUPED, 'Keuangan', 'Alpha', 'Hermes & sistem', 'Sejarah Persib', 'Keuangan']), [
    'Sejarah Persib',
    'Keuangan',
    'Hermes & sistem',
    'Alpha',
    'Zeta',
    UNGROUPED,
  ]);
});
