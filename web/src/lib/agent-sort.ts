// Sort orders for the agents list. Sorting happens inside each group; rows with no value for
// the chosen key (e.g. never run) always go last, whichever direction is chosen.

export const SORT_OPTIONS = [
  { value: 'name', label: 'Name A–Z' },
  { value: 'name_desc', label: 'Name Z–A' },
  { value: 'next', label: 'Next run (soonest)' },
  { value: 'last', label: 'Last run (newest)' },
  { value: 'last_old', label: 'Last run (oldest)' },
  { value: 'failing', label: 'Failing first' },
] as const;

export type SortKey = (typeof SORT_OPTIONS)[number]['value'];

export interface SortableJob {
  name: string | null;
  state: 'active' | 'paused' | 'done';
  next_run_at: string | null;
  last_run_at: string | null;
  failing: boolean;
}

export const parseSort = (value: string | null): SortKey | null => (SORT_OPTIONS.some((o) => o.value === value) ? (value as SortKey) : null);

const STATE_RANK = { active: 0, paused: 1, done: 2 } as const;
const byName = (a: SortableJob, b: SortableJob) => (a.name ?? '').localeCompare(b.name ?? '', undefined, { sensitivity: 'base' });

/** Compare ISO timestamps; a missing value sorts after any real one. `desc` flips real values only. */
function byTime(x: string | null, y: string | null, desc: boolean): number {
  if (!x && !y) return 0;
  if (!x) return 1;
  if (!y) return -1;
  const diff = Date.parse(x) - Date.parse(y);
  return desc ? -diff : diff;
}

export function compareJobs(sort: SortKey | null, a: SortableJob, b: SortableJob): number {
  switch (sort) {
    case 'name':
      return byName(a, b);
    case 'name_desc':
      return -byName(a, b);
    case 'next':
      return byTime(a.next_run_at, b.next_run_at, false) || byName(a, b);
    case 'last':
      return byTime(a.last_run_at, b.last_run_at, true) || byName(a, b);
    case 'last_old':
      return byTime(a.last_run_at, b.last_run_at, false) || byName(a, b);
    case 'failing':
      return Number(b.failing) - Number(a.failing) || byTime(a.last_run_at, b.last_run_at, true) || byName(a, b);
    default:
      // Default: active first, then paused, then done; soonest run first; then by name.
      return STATE_RANK[a.state] - STATE_RANK[b.state] || byTime(a.next_run_at, b.next_run_at, false) || byName(a, b);
  }
}
