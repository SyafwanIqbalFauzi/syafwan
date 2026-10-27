// Server side of "send a reply": start the Hermes run that sends the email, wait for it, and record the
// outcome on the feedback row in the sejarahpersib.com Directus. Used by reply.ts (starts and waits) and
// reply-done.ts (picks up a run that was still going when the first request gave up waiting).
import { audit } from './auth';
import { parseSendResult, type ReplyInput } from './feedback.ts';
import { hermesGet } from './hermes';
import { patchFeedback } from './persib-directus';

export const RUN_ID = /^[A-Za-z0-9_.:-]{1,128}$/;
const TERMINAL = new Set(['completed', 'failed', 'cancelled', 'interrupted']);

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

export type FinishResult =
  | { state: 'sent'; repliedAt: string }
  | { state: 'failed'; error: string }
  | { state: 'pending' };

/** Reads the run once it is over; records the reply only if the agent confirmed this feedback's id. */
export async function finishReply(id: number, runId: string, input: Pick<ReplyInput, 'from' | 'subject' | 'body'>, run: RunSnapshot | null, user: string | undefined): Promise<FinishResult> {
  if (!run || !run.status || !TERMINAL.has(run.status)) return { state: 'pending' };
  if (run.status !== 'completed') {
    audit('feedback_reply_failed', { user, id, run: runId, status: run.status });
    return { state: 'failed', error: 'The agent run did not finish, so the email was probably not sent.' };
  }
  const outcome = parseSendResult(id, run.output);
  if (!outcome.sent) {
    audit('feedback_reply_failed', { user, id, run: runId, reason: outcome.reason });
    return { state: 'failed', error: outcome.reason };
  }
  const repliedAt = new Date().toISOString();
  await patchFeedback(id, { dibalas_pada: repliedAt, balasan_dari: input.from, balasan_subjek: input.subject, balasan_isi: input.body, ditinjau_pada: repliedAt });
  audit('feedback_reply_sent', { user, id, run: runId, from: input.from, message: outcome.messageId });
  return { state: 'sent', repliedAt };
}
