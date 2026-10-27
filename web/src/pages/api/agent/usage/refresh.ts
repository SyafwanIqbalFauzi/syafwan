// Refresh button on /agent/usage. POST runs the `sync-claude-usage` Hermes job now (the job is found
// by name, never by an id the browser supplies); GET reports the newest `checked_at` so the page can
// tell when the fresh numbers have landed.
import type { APIRoute } from 'astro';
import { audit } from '../../../../lib/auth';
import { readItems, type ClaudeUsageRow } from '../../../../lib/directus-user';
import { hermesGet, hermesRequest } from '../../../../lib/hermes';
import { findSyncJobId, latestCheckedAt } from '../../../../lib/usage-refresh';

export const prerender = false;

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' } });

export const GET: APIRoute = async ({ locals }) => {
  try {
    const { data } = await readItems<ClaudeUsageRow>(locals.hermesToken!, 'claude_usage', { limit: -1 });
    return json(200, { checkedAt: latestCheckedAt(data) });
  } catch {
    return json(502, { error: 'Could not read the usage numbers' });
  }
};

export const POST: APIRoute = async ({ locals }) => {
  const list = await hermesGet<unknown>('/api/jobs');
  if (!list) return json(502, { error: 'Could not reach Hermes' });
  const id = findSyncJobId(list);
  if (!id) return json(404, { error: 'The usage sync job is not set up in Hermes' });
  const res = await hermesRequest('POST', `/api/jobs/${id}/run`, {});
  if (!res.ok) return json(502, { error: 'Hermes could not start the sync' });
  audit('usage_refresh', { user: locals.hermesUser?.email, job: id });
  return json(202, { started: true });
};
