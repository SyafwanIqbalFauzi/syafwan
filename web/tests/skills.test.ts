import assert from 'node:assert/strict';
import { test } from 'node:test';
import { applyAssignment, MAX_SKILLS_PER_AGENT, parseSkillSort, sortSkills, usageMap, type SkillItem } from '../src/lib/skills.ts';

test('usageMap lists agents per skill and ignores removed agents', () => {
  const map = usageMap([
    { job_id: 'a', name: 'alpha', skills: ['s1', 's2'] },
    { job_id: 'b', name: 'beta', skills: ['s1'] },
    { job_id: 'c', name: 'gone', skills: ['s1'], state: 'removed' },
    { job_id: 'd', name: null, skills: null },
  ]);
  assert.deepEqual(map.get('s1')?.map((j) => j.job_id), ['a', 'b']);
  assert.deepEqual(map.get('s2')?.map((j) => j.job_id), ['a']);
  assert.equal(map.get('s3'), undefined);
});

test('applyAssignment adds, removes and de-duplicates', () => {
  assert.deepEqual(applyAssignment(['a'], 'b', 'add'), ['a', 'b']);
  assert.deepEqual(applyAssignment(['a', 'b'], 'a', 'add'), ['b', 'a']); // moved to the end, never duplicated
  assert.deepEqual(applyAssignment(['a', 'b'], 'a', 'remove'), ['b']);
  assert.deepEqual(applyAssignment(['a'], 'zzz', 'remove'), ['a']);
  assert.deepEqual(applyAssignment([], 'a', 'remove'), []);
});

test('applyAssignment rejects bad names and too many skills', () => {
  assert.equal(applyAssignment([], '../etc', 'add'), null);
  assert.equal(applyAssignment([], 'a b', 'add'), null);
  assert.equal(applyAssignment([], '', 'add'), null);
  const full = Array.from({ length: MAX_SKILLS_PER_AGENT }, (_, i) => `s${i}`);
  assert.equal(applyAssignment(full, 'extra', 'add'), null);
  assert.ok(applyAssignment(full, 's3', 'add')); // already attached: allowed
  assert.ok(applyAssignment(full, 's3', 'remove'));
});

test('sorting by name, category and usage', () => {
  const skill = (name: string, category: string): SkillItem => ({ name, category, source: 'local', description: null, version: null, enabled: true });
  const items = [skill('zeta', 'a'), skill('alpha', 'b'), skill('mid', 'a')];
  const used = new Map<string, unknown[]>([['mid', [1, 2]], ['alpha', [1]]]);
  assert.deepEqual(sortSkills(items, 'name', used).map((s) => s.name), ['alpha', 'mid', 'zeta']);
  assert.deepEqual(sortSkills(items, 'category', used).map((s) => s.name), ['mid', 'zeta', 'alpha']);
  assert.deepEqual(sortSkills(items, 'used', used).map((s) => s.name), ['mid', 'alpha', 'zeta']);
});

test('parseSkillSort falls back to name', () => {
  assert.equal(parseSkillSort('used'), 'used');
  assert.equal(parseSkillSort('category'), 'category');
  assert.equal(parseSkillSort('x'), 'name');
  assert.equal(parseSkillSort(null), 'name');
});
