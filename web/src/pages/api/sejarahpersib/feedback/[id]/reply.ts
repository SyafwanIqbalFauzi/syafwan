// Sends the owner's reply to one feedback by email, through a Hermes run that uses the chosen connected
// Google account. The recipient is the email stored with the feedback (never taken from the browser) and the
// sender must be a connected account that may send mail. The run goes on in the background: this route
// answers as soon as it has started (202) and the outcome is saved on the feedback row by watchSend.
import type { APIRoute } from 'astro';
import { audit } from '../../../../../lib/auth';
import { readItems } from '../../../../../lib/directus-user';
import { checkReply, isEmail, parsePending, PENDING_MAX_AGE_MS, sendPrompt, senderAccounts, serializePending, type PendingSend, type SenderRow } from '../../../../../lib/feedback.ts';
import { markSendFailed, watchSend } from '../../../../../lib/feedback-reply';
import { hermesRequest } from '../../../../../lib/hermes';
import { getFeedback, patchFeedback } from '../../../../../lib/persib-directus';

export const prerender = false;

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' } });

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

  // One send at a time per message: a second click while the first is in flight would email the visitor twice.
  const inFlight = row.balasan_status === 'sending' ? parsePending(row.balasan_run) : null;
  if (inFlight && Date.now() - Date.parse(inFlight.started_at) <= PENDING_MAX_AGE_MS) {
    return json(409, { error: 'A reply to this message is already being sent.' });
  }

  // Claim the row first, so the card shows "Sending" even if this request dies right after the run starts.
  const pending: PendingSend = { run_id: null, ...checked.value, started_at: new Date().toISOString(), resend: Boolean(row.dibalas_pada) };
  try {
    await patchFeedback(id, { balasan_status: 'sending', balasan_error: null, balasan_run: serializePending(pending) });
  } catch {
    return json(502, { error: 'Could not save the sending state, so nothing was sent.' });
  }

  const started = await hermesRequest('POST', '/v1/runs', { input: sendPrompt(id, checked.value, row.email), session_id: `feedback-reply-${id}-${Date.now()}` });
  const runId = started.json?.run_id;
  if (!started.ok || typeof runId !== 'string') {
    await markSendFailed(id, 'Hermes did not accept the request, so nothing was sent.').catch(() => {});
    return json(502, { error: 'Hermes did not accept the request' });
  }
  audit('feedback_reply_start', { user, id, run: runId, from: checked.value.from });

  const tracked: PendingSend = { ...pending, run_id: runId };
  await patchFeedback(id, { balasan_run: serializePending(tracked) }).catch(() => {
    // Not fatal: the watcher below still records the outcome; only a restart in the next minutes would lose the run id.
  });
  watchSend(id, runId, tracked, user);
  return json(202, { state: 'sending', run_id: runId });
};
