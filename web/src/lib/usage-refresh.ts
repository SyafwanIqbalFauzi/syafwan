// Pure helpers for the Refresh button on /agent/usage. The Claude plan numbers are written by the
// Hermes cron job below; refreshing means running that job now and waiting for a newer `checked_at`.

export const SYNC_JOB_NAME = 'sync-claude-usage';

/** Id of the sync job in a Hermes `/api/jobs` payload, or null when it is missing or removed. */
export function findSyncJobId(payload: unknown): string | null {
  const jobs = Array.isArray(payload) ? payload : Array.isArray((payload as any)?.jobs) ? (payload as any).jobs : [];
  for (const job of jobs) {
    if (job?.name !== SYNC_JOB_NAME) continue;
    const id = job.id ?? job.job_id;
    if (typeof id === 'string' && /^[A-Za-z0-9_.:-]{1,128}$/.test(id)) return id;
  }
  return null;
}

/** Newest `checked_at` over the usage rows (ISO strings), or null. */
export function latestCheckedAt(rows: { checked_at: string | null }[]): string | null {
  let best: number | null = null;
  let bestIso: string | null = null;
  for (const r of rows) {
    const t = r.checked_at ? Date.parse(r.checked_at) : NaN;
    if (!Number.isNaN(t) && (best === null || t > best)) {
      best = t;
      bestIso = r.checked_at;
    }
  }
  return bestIso;
}

/** True once `after` is a later timestamp than `before` (no `before` means any timestamp counts). */
export function isNewer(before: string | null, after: string | null): boolean {
  const a = after ? Date.parse(after) : NaN;
  if (Number.isNaN(a)) return false;
  const b = before ? Date.parse(before) : NaN;
  return Number.isNaN(b) || a > b;
}
