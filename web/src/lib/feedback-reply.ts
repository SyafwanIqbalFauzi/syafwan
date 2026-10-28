// Server side of "send a reply", done in the background. reply.ts claims the row and starts the Hermes run that
// sends the email, then answers at once; `watchSend` (no browser needed) waits for the run and records the
// outcome on the feedback row in the sejarahpersib.com Directus. `reconcileSend` settles whatever is still
// marked "sending" when a page is opened or polled, so a deploy in the middle never loses the outcome.
import { audit } from './auth';
import { outcomeOfRun, parsePending, PENDING_MAX_AGE_MS, STALE_SEND_ERROR, type FeedbackRow, type PendingSend } from './feedback.ts';
import { hermesGet } from './hermes';
import { patchFeedback } from './persib-directus';

export const RUN_ID = /^[A-Za-z0-9_.:-]{1,128}$/;
const TERMINAL = new Set(['completed', 'failed', 'cancelled', 'interrupted']);
/** How long the background watcher waits for the agent before leaving the row to `reconcileSend`. */
const WATCH_MS = 10 * 60_000;

export interface RunSnapshot {
  status?: string;
  output?: string | null;
}

export async function waitForRun(runId: string, maxMs: number, intervalMs = 2000): Promise<RunSnapshot | null> {
  const until = Date.now() + maxMs;
  let last: RunSnapshot | null = null;
  while (Date.now() < until) {
    last = await hermesGet<RunSnapshot>(`/v1/runs/${runId}`);
    if (last?.status && TERMINAL.has(last.status)) return last;
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }
  return last && last.status && TERMINAL.has(last.status) ? last : null;
}

export type Settled = { state: 'sent'; repliedAt: string } | { state: 'failed'; error: string } | { state: 'pending' };

/** Writes the failure on the row. The pending payload stays so the owner can try again with the same text. */
export async function markSendFailed(id: number, error: string): Promise<void> {
  await patchFeedback(id, { balasan_status: 'failed', balasan_error: error.slice(0, 300) });
}

/** Records the outcome of one send run on the row. Does nothing while the run is not over. */
export async function settleSend(id: number, runId: string, pending: PendingSend, run: RunSnapshot | null, user: string | undefined): Promise<Settled> {
  const end = outcomeOfRun(id, run);
  if (end.state === 'pending') return end;
  if (end.state === 'failed') {
    audit('feedback_reply_failed', { user, id, run: runId, reason: end.error });
    await markSendFailed(id, end.error);
    return end;
  }
  const repliedAt = new Date().toISOString();
  await patchFeedback(id, {
    dibalas_pada: repliedAt,
    balasan_dari: pending.from,
    balasan_subjek: pending.subject,
    balasan_isi: pending.body,
    ditinjau_pada: repliedAt,
    balasan_status: null,
    balasan_error: null,
    balasan_run: null,
  });
  audit('feedback_reply_sent', { user, id, run: runId, from: pending.from, message: end.messageId });
  return { state: 'sent', repliedAt };
}

/** Fire and forget: called after the response was sent. Never throws. */
export function watchSend(id: number, runId: string, pending: PendingSend, user: string | undefined): void {
  void (async () => {
    try {
      const run = await waitForRun(runId, WATCH_MS, 3000);
      await settleSend(id, runId, pending, run, user);
    } catch {
      // The row stays "sending"; the next page load or status poll settles it.
      audit('feedback_reply_watch_error', { user, id, run: runId });
    }
  })();
}

/**
 * Settles one row marked "sending": reads its run, records the outcome, or declares it failed when it has
 * been unresolved for too long. Returns the row as it should now be shown.
 */
export async function reconcileSend(row: FeedbackRow, user?: string): Promise<FeedbackRow> {
  if (row.balasan_status !== 'sending') return row;
  const pending = parsePending(row.balasan_run);
  const tooOld = !pending || Date.now() - Date.parse(pending.started_at) > PENDING_MAX_AGE_MS;
  try {
    if (pending?.run_id) {
      const run = await hermesGet<RunSnapshot>(`/v1/runs/${pending.run_id}`);
      const result = await settleSend(row.id, pending.run_id, pending, run, user);
      if (result.state === 'sent') {
        return { ...row, dibalas_pada: result.repliedAt, ditinjau_pada: result.repliedAt, balasan_dari: pending.from, balasan_subjek: pending.subject, balasan_isi: pending.body, balasan_status: null, balasan_error: null, balasan_run: null };
      }
      if (result.state === 'failed') return { ...row, balasan_status: 'failed', balasan_error: result.error };
    }
    if (tooOld) {
      await markSendFailed(row.id, STALE_SEND_ERROR);
      return { ...row, balasan_status: 'failed', balasan_error: STALE_SEND_ERROR };
    }
  } catch {
    // Directus or Hermes was unreachable just now: show the row as it is, the next look tries again.
  }
  return row;
}
