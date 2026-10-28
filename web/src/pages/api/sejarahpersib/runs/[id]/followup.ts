// Starts a Hermes chat run that follows up on one agent result shown on /sejarahpersib. The prompt is built
// here from the stored run (never from browser text except the owner's own instruction). The run keeps going
// without the page; the modal watches it through GET /api/agent/runs/<id> and can link to the chat session.
import type { APIRoute } from 'astro';
import { audit } from '../../../../../lib/auth';
import { readItem, updateItem } from '../../../../../lib/directus-user';
import { checkFollowup, followupPrompt, followupSessionId, type FollowupRun } from '../../../../../lib/followup.ts';
import { hermesRequest } from '../../../../../lib/hermes';
import { isPersibJob } from '../../../../../lib/updates.ts';

export const prerender = false;

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' } });

export const POST: APIRoute = async ({ params, request, locals }) => {
  if (!params.id || !/^\d{1,9}$/.test(params.id)) return json(404, { error: 'Unknown result' });
  const id = Number(params.id);
  const user = locals.hermesUser?.email;
  const token = locals.hermesToken!;

  const checked = checkFollowup(await request.json().catch(() => null));
  if (!checked.ok) return json(400, { error: checked.error });

  let run: (FollowupRun & { id: number }) | null;
  try {
    run = await readItem<FollowupRun & { id: number }>(token, 'agent_runs', {
      'filter[id][_eq]': id,
      fields: 'id,job_name,started_at,status,check_reason,error,response_md',
    });
  } catch {
    return json(502, { error: 'Could not read that result' });
  }
  if (!run || !isPersibJob(run.job_name)) return json(404, { error: 'Unknown result' });

  const sessionId = followupSessionId(id, Date.now());
  const started = await hermesRequest('POST', '/v1/runs', { input: followupPrompt(run, checked.value.instruction), session_id: sessionId });
  const runId = started.json?.run_id;
  if (!started.ok || typeof runId !== 'string') {
    return json(started.status === 429 ? 429 : 502, { error: 'Hermes did not accept the request' });
  }
  audit('persib_followup', { user, id, job: run.job_name, session: sessionId, run: runId, chars: checked.value.instruction.length });

  // The badge on the row is a convenience: the run is already going, so a failed save is not an error.
  let saved = true;
  try {
    await updateItem(token, 'agent_runs', id, { followup_at: new Date().toISOString(), followup_session: sessionId });
  } catch {
    saved = false;
  }
  return json(202, { run_id: runId, session_id: sessionId, saved });
};
