// The /sejarahpersib feed: every result an agent produced, grouped into a few categories, with the
// ones that need a person to look at them marked. Pure functions so they are unit tested; the page
// only paints this. Rows come from Directus `agent_runs` (filled by scripts/hermes/sync_agent_runs.py).

export const CATEGORIES = [
  { key: 'all', label: 'All' },
  { key: 'research', label: 'Research' },
  { key: 'schedule', label: 'Schedule & standings' },
  { key: 'dev', label: 'UI/UX & dev' },
  { key: 'system', label: 'System' },
] as const;

export type Category = (typeof CATEGORIES)[number]['key'];
export type RealCategory = Exclude<Category, 'all'>;

/** First matching rule wins; anything unknown is "system", so a new job never disappears from the feed. */
const RULES: [RegExp, RealCategory][] = [
  [/^(riset-jadwal|riset-klasemen|update-klasemen|monitoring-jadwal)/, 'schedule'],
  [/^(riset-|ide-konten)/, 'research'],
  [/^(ui-ux|ux-scan|dev-persib|chain-uiux|cek-rantai|code-improvement|rekap-pr)/, 'dev'],
];

export function categoryOf(jobName: string | null | undefined): RealCategory {
  const name = (jobName ?? '').toLowerCase();
  return RULES.find(([re]) => re.test(name))?.[1] ?? 'system';
}

/** The category named by `?cat=`; anything unknown (or missing) means "All". */
export function parseCategory(value: unknown): Category {
  return CATEGORIES.find((c) => c.key === value)?.key ?? 'all';
}

export interface RunRow {
  id: number;
  execution_id?: string;
  job_id: string;
  job_name: string | null;
  kind: 'agent' | 'script' | null;
  status: 'completed' | 'failed' | 'unknown' | null;
  started_at: string | null;
  summary: string | null;
  error: string | null;
  needs_check?: boolean | null;
  check_reason?: string | null;
  checked_at?: string | null;
}

/** A failed run counts as "needs a look" only for this long; an agent-flagged one stays until it is marked. */
export const FAILED_WINDOW_MS = 7 * 86_400_000;

/** Does this run need the owner to look at it and has not been marked as checked yet? */
export function needsCheck(run: Pick<RunRow, 'status' | 'needs_check' | 'checked_at' | 'started_at'>, now = Date.now()): boolean {
  if (run.checked_at) return false;
  if (run.needs_check === true) return true;
  if (run.status !== 'failed') return false;
  const started = run.started_at ? Date.parse(run.started_at) : NaN;
  return Number.isFinite(started) && now - started <= FAILED_WINDOW_MS;
}

/** Why the tag is shown: the agent's own reason, or the plain fact that the run failed. */
export function checkReason(run: Pick<RunRow, 'status' | 'needs_check' | 'check_reason' | 'error'>): string {
  if (run.needs_check === true) return (run.check_reason ?? '').trim() || 'The agent asked you to take a look';
  const err = (run.error ?? '').trim();
  return err ? `The run failed: ${err.slice(0, 160)}` : 'The run failed';
}

/**
 * Directus query params that select the same runs `needsCheck` accepts, so the sidebar badge can count
 * them without loading rows. Keep both in step (tests compare them).
 */
export function attentionParams(now = Date.now()): Record<string, string> {
  const since = new Date(now - FAILED_WINDOW_MS).toISOString();
  return {
    'filter[_and][0][checked_at][_null]': 'true',
    'filter[_and][1][_or][0][needs_check][_eq]': 'true',
    'filter[_and][1][_or][1][_and][0][status][_eq]': 'failed',
    'filter[_and][1][_or][1][_and][1][started_at][_gte]': since,
  };
}

export interface FeedItem {
  run: RunRow;
  category: RealCategory;
  attention: boolean;
  reason: string | null;
}

export interface FeedView {
  items: FeedItem[];
  counts: Record<Category, number>;
  attention: number;
}

/** A run stored twice (see sync_agent_runs.py: the document was synced before its execution was recorded) shows once. */
export const DUPLICATE_WINDOW_MS = 15 * 60_000;

/**
 * Drops the `file:` copy of a run when the same job has a row with the same text recorded within a few
 * minutes: the copy that carries the real execution id has the true status and duration. Rows that are
 * unique stay, `file:` or not.
 */
export function dedupeRuns<T extends Pick<RunRow, 'job_id' | 'execution_id' | 'summary' | 'started_at'>>(rows: T[]): T[] {
  const isCopy = (r: T) => (r.execution_id ?? '').startsWith('file:');
  const keepers = rows.filter((r) => !isCopy(r));
  return rows.filter((r) => {
    if (!isCopy(r)) return true;
    const at = Date.parse(r.started_at ?? '');
    return !keepers.some(
      (k) => k.job_id === r.job_id && (k.summary ?? '') === (r.summary ?? '') && Math.abs(Date.parse(k.started_at ?? '') - at) <= DUPLICATE_WINDOW_MS,
    );
  });
}

/** Newest first. `cat` filters the list; counts always cover everything so the tabs stay stable. */
export function feedView(rows: RunRow[], cat: Category, onlyAttention: boolean, now = Date.now()): FeedView {
  const all: FeedItem[] = dedupeRuns(rows)
    .map((run) => {
      const attention = needsCheck(run, now);
      return { run, category: categoryOf(run.job_name), attention, reason: attention ? checkReason(run) : null };
    })
    .sort((a, b) => Date.parse(b.run.started_at ?? '') - Date.parse(a.run.started_at ?? '') || b.run.id - a.run.id);
  const counts: Record<Category, number> = { all: all.length, research: 0, schedule: 0, dev: 0, system: 0 };
  for (const item of all) counts[item.category]++;
  const items = all.filter((i) => (cat === 'all' || i.category === cat) && (!onlyAttention || i.attention));
  return { items, counts, attention: all.filter((i) => i.attention).length };
}

export interface StatusJob {
  name: string | null;
  last_status: string | null;
  last_run_at: string | null;
}

export interface StatusCell {
  label: string;
  tone: 'ok' | 'fail' | 'idle';
  text: string;
  at: string | null;
}

/** The status strip: the job's own last result (silent successful ticks never become feed rows). */
export const STATUS_WATCH = [{ label: 'Website', job: 'watchdog-web-persib-cheap' }] as const;

export function statusCells(jobs: StatusJob[]): StatusCell[] {
  return STATUS_WATCH.map(({ label, job }) => {
    const found = jobs.find((j) => j.name === job);
    if (!found || !found.last_status) return { label, tone: 'idle', text: 'no data', at: found?.last_run_at ?? null };
    const ok = found.last_status === 'ok';
    return { label, tone: ok ? 'ok' : 'fail', text: ok ? 'healthy' : 'needs a look', at: found.last_run_at };
  });
}
