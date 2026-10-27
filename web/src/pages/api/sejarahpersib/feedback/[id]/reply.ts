// Sends the owner's reply to one feedback by email, through a Hermes run that uses the chosen connected
// Google account. The recipient is the email stored with the feedback (never taken from the browser) and the
// sender must be a connected account that may send mail. The outcome is saved on the feedback row.
import type { APIRoute } from 'astro';
import { audit } from '../../../../../lib/auth';
import { readItems } from '../../../../../lib/directus-user';
import { checkReply, isEmail, sendPrompt, senderAccounts, type SenderRow } from '../../../../../lib/feedback.ts';
import { finishReply, waitForRun } from '../../../../../lib/feedback-reply';
import { hermesRequest } from '../../../../../lib/hermes';
import { getFeedback } from '../../../../../lib/persib-directus';

export const prerender = false;

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' } });

/** How long this request waits for the agent before telling the page to keep watching. */
const WAIT_MS = 75_000;

export const POST: APIRoute = async ({ params, request, locals }) => {
  if (!params.id || !/^\d{1,9}$/.test(params.id)) return json(404, { error: 'Unknown feedback' });
  const id = Number(params.id);
  const user = locals.hermesUser?.email;
  const token = locals.hermesToken!;

  const accounts = await readItems<SenderRow>(token, 'connected_accounts', { limit: -1 }).catch(() => null);
  if (!accounts) return json(502, { error: 'Could not read the connected accounts' });
  const checked = checkReply(await request.json().catch(() => null), senderAccounts(accounts.data));
  if (!checked.ok) return json(400, { error: checked.error });

  let row;
  try {
    row = await getFeedback(id);
  } catch {
    return json(502, { error: 'Could not read that feedback' });
  }
  if (!row) return json(404, { error: 'Unknown feedback' });
  if (!isEmail(row.email)) return json(409, { error: 'This feedback has no valid email address to reply to.' });
  if (row.dibalas_pada && !checked.value.resend) return json(409, { error: 'A reply was already sent. Confirm to send another one.', replied: true });

  const started = await hermesRequest('POST', '/v1/runs', { input: sendPrompt(id, checked.value, row.email), session_id: `feedback-reply-${id}-${Date.now()}` });
  const runId = started.json?.run_id;
  if (!started.ok || typeof runId !== 'string') return json(502, { error: 'Hermes did not accept the request' });
  audit('feedback_reply_start', { user, id, run: runId, from: checked.value.from });

  const run = await waitForRun(runId, WAIT_MS);
  try {
    const result = await finishReply(id, runId, checked.value, run, user);
    if (result.state === 'sent') return json(200, { state: 'sent', repliedAt: result.repliedAt });
    if (result.state === 'failed') return json(502, { state: 'failed', error: result.error });
    return json(202, { state: 'pending', run_id: runId });
  } catch {
    return json(502, { state: 'failed', error: 'The email may have been sent, but saving the reply failed. Check the sent folder before trying again.' });
  }
};
