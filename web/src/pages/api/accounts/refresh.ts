// "Check now" on /accounts. POST runs the `sync-accounts` Hermes job now (found by name, never by an id the
// browser supplies); GET reports the newest `checked_at` so the page can tell when fresh statuses landed.
import type { APIRoute } from 'astro';
import { audit } from '../../../lib/auth';
import { readItems, type ReadableCollection } from '../../../lib/directus-user';
import { hermesGet, hermesRequest } from '../../../lib/hermes';
import { latestCheckedAt, findSyncJobId } from '../../../lib/usage-refresh';
import { SYNC_JOB_NAME } from '../../../lib/accounts-refresh';

export const prerender = false;

const COLLECTION: ReadableCollection = 'connected_accounts';
const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' } });

export const GET: APIRoute = async ({ locals }) => {
  try {
    const { data } = await readItems<{ checked_at: string | null }>(locals.hermesToken!, COLLECTION, { limit: -1, fields: 'checked_at' });
    return json(200, { checkedAt: latestCheckedAt(data) });
  } catch {
    return json(502, { error: 'Could not read the account statuses' });
  }
};

export const POST: APIRoute = async ({ locals }) => {
  const list = await hermesGet<unknown>('/api/jobs');
  if (!list) return json(502, { error: 'Could not reach Hermes' });
  const id = findSyncJobId(list, SYNC_JOB_NAME);
  if (!id) return json(404, { error: 'The account check job is not set up in Hermes' });
  const res = await hermesRequest('POST', `/api/jobs/${id}/run`, {});
  if (!res.ok) return json(502, { error: 'Hermes could not start the check' });
  audit('accounts_refresh', { user: locals.hermesUser?.email, job: id });
  return json(202, { started: true });
};
