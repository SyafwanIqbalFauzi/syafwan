// Picks up a reply run that was still going when reply.ts stopped waiting: reads the run again and, if the
// agent confirmed the send, saves the reply on the feedback row. Safe to call repeatedly.
import type { APIRoute } from 'astro';
import { readItems } from '../../../../../lib/directus-user';
import { checkReply, senderAccounts, type SenderRow } from '../../../../../lib/feedback.ts';
import { finishReply, RUN_ID, waitForRun } from '../../../../../lib/feedback-reply';
import { getFeedback } from '../../../../../lib/persib-directus';

export const prerender = false;

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' } });

export const POST: APIRoute = async ({ params, request, locals }) => {
  if (!params.id || !/^\d{1,9}$/.test(params.id)) return json(404, { error: 'Unknown feedback' });
  const id = Number(params.id);
  const data = await request.json().catch(() => null);
  const runId = typeof data?.run_id === 'string' ? data.run_id : '';
  if (!RUN_ID.test(runId)) return json(400, { error: 'Invalid run' });

  const accounts = await readItems<SenderRow>(locals.hermesToken!, 'connected_accounts', { limit: -1 }).catch(() => null);
  if (!accounts) return json(502, { error: 'Could not read the connected accounts' });
  const checked = checkReply(data, senderAccounts(accounts.data));
  if (!checked.ok) return json(400, { error: checked.error });

  try {
    const row = await getFeedback(id);
    if (!row) return json(404, { error: 'Unknown feedback' });
    const run = await waitForRun(runId, 8_000, 2000);
    const result = await finishReply(id, runId, checked.value, run, locals.hermesUser?.email);
    if (result.state === 'sent') return json(200, { state: 'sent', repliedAt: result.repliedAt });
    if (result.state === 'failed') return json(502, { state: 'failed', error: result.error });
    return json(202, { state: 'pending', run_id: runId });
  } catch {
    return json(502, { state: 'failed', error: 'The email may have been sent, but saving the reply failed. Check the sent folder before trying again.' });
  }
};
