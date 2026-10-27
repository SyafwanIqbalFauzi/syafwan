// Progress of one connect request: only status and result (the consent link, or a message). Never the pasted address.
import type { APIRoute } from 'astro';
import { readItem, type AccountRequestRow } from '../../../../lib/directus-user';
import { requestState, safeAuthUrl } from '../../../../lib/account-connect';

export const prerender = false;

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' } });

export const GET: APIRoute = async ({ params, locals }) => {
  const id = Number(params.id);
  if (!Number.isInteger(id) || id < 1) return json(404, { error: 'Unknown request' });
  let row: AccountRequestRow | null;
  try {
    row = await readItem<AccountRequestRow>(locals.hermesToken!, 'account_requests', { 'filter[id][_eq]': id, fields: 'id,action,status,result' });
  } catch {
    return json(502, { error: 'Could not read the request' });
  }
  if (!row) return json(404, { error: 'Unknown request' });
  const state = requestState(row.status);
  if (state === 'waiting') return json(200, { state });
  if (state === 'failed') return json(200, { state, message: (row.result ?? 'Something went wrong.').slice(0, 400) });
  if (row.action === 'start') {
    const url = safeAuthUrl(row.result);
    return url ? json(200, { state, url }) : json(200, { state: 'failed', message: 'The server returned an unexpected link. Try again.' });
  }
  return json(200, { state, message: (row.result ?? 'Connected.').slice(0, 400) });
};
