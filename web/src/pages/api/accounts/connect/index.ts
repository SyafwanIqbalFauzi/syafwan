// Connect / reconnect a Google account. POST records a request in Directus (`account_requests`) and starts the
// VPS job that handles it (found by name). The browser never sees a token; the pasted address (which holds a
// one-time code) is stored only until the VPS has used it, then cleared. GET ./[id] reports progress.
import type { APIRoute } from 'astro';
import { audit } from '../../../../lib/auth';
import { createItem } from '../../../../lib/directus-user';
import { hermesGet, hermesRequest } from '../../../../lib/hermes';
import { findSyncJobId } from '../../../../lib/usage-refresh';
import { CONNECT_JOB_NAME, parseConnect } from '../../../../lib/account-connect';

export const prerender = false;

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' } });

export const POST: APIRoute = async ({ request, locals }) => {
  const parsed = parseConnect(await request.json().catch(() => null));
  if (!parsed.ok) return json(400, { error: parsed.error });
  const { data } = parsed;

  let row: { id: number };
  try {
    row = await createItem<{ id: number }>(locals.hermesToken!, 'account_requests', {
      action: data.action,
      identifier: data.identifier,
      label: data.action === 'start' ? data.label : null,
      payload: data.action === 'finish' ? data.payload : null,
      status: 'pending',
      requested_by: locals.hermesUser?.email ?? null,
      requested_at: new Date().toISOString(),
    });
  } catch {
    return json(502, { error: 'Could not record the request' });
  }
  audit('account_connect', { user: locals.hermesUser?.email, action: data.action, account: data.identifier, request: row.id });

  // Start the job now instead of waiting for its next scheduled run. If that fails the schedule still picks it up.
  let started = false;
  const list = await hermesGet<unknown>('/api/jobs');
  const jobId = list ? findSyncJobId(list, CONNECT_JOB_NAME) : null;
  if (jobId) started = (await hermesRequest('POST', `/api/jobs/${jobId}/run`, {})).ok;
  return json(202, { id: row.id, started });
};
