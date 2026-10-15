// Skill catalogue helpers: which agents use which skill, filtering/sorting for the list, and the
// add/remove arithmetic used when attaching a skill to an agent.

export const MAX_SKILLS_PER_AGENT = 20;
export const SKILL_NAME = /^[A-Za-z0-9][A-Za-z0-9._-]{0,79}$/;

export interface SkillItem {
  name: string;
  category: string | null;
  source: string | null;
  description: string | null;
  version: string | null;
  enabled: boolean | null;
}

export interface JobRef {
  job_id: string;
  name: string | null;
  skills: string[] | null;
  state?: string | null;
}

/** skill name -> the agents that use it (removed agents are ignored). */
export function usageMap(jobs: JobRef[]): Map<string, { job_id: string; name: string }[]> {
  const map = new Map<string, { job_id: string; name: string }[]>();
  for (const job of jobs) {
    if (job.state === 'removed') continue;
    for (const skill of job.skills ?? []) {
      const list = map.get(skill) ?? [];
      list.push({ job_id: job.job_id, name: job.name ?? job.job_id });
      map.set(skill, list);
    }
  }
  return map;
}

/** The new skills list after attaching/detaching one skill; null when the change is not allowed. */
export function applyAssignment(current: string[], skill: string, action: 'add' | 'remove'): string[] | null {
  if (!SKILL_NAME.test(skill)) return null;
  const without = current.filter((s) => s !== skill);
  if (action === 'remove') return without;
  if (without.length + 1 > MAX_SKILLS_PER_AGENT) return null;
  return [...without, skill];
}

export type SkillSort = 'name' | 'category' | 'used';
export const SKILL_SORTS: { value: SkillSort; label: string }[] = [
  { value: 'category', label: 'Category' },
  { value: 'used', label: 'Most used' },
];
export const parseSkillSort = (value: string | null): SkillSort => (value === 'category' || value === 'used' ? value : 'name');

export function sortSkills<T extends SkillItem>(items: T[], sort: SkillSort, used: Map<string, unknown[]>): T[] {
  const byName = (a: T, b: T) => a.name.localeCompare(b.name);
  const count = (s: T) => used.get(s.name)?.length ?? 0;
  const copy = [...items];
  if (sort === 'category') return copy.sort((a, b) => (a.category ?? '').localeCompare(b.category ?? '') || byName(a, b));
  if (sort === 'used') return copy.sort((a, b) => count(b) - count(a) || byName(a, b));
  return copy.sort(byName);
}
