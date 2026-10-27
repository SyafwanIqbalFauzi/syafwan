// Marks one agent result as looked at (POST) or puts it back (DELETE) on /sejarahpersib.
// Only `checked_at` is written; the same-origin rule for mutations is enforced by the middleware.
import type { APIRoute } from 'astro';
import { audit } from '../../../../../lib/auth';
import { readItem, updateItem } from '../../../../../lib/directus-user';

export const prerender = false;

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' } });

async function setChecked(params: Record<string, string | undefined>, locals: App.Locals, value: string | null) {
  if (!params.id || !/^\d{1,9}$/.test(params.id)) return json(404, { error: 'Unknown result' });
  const id = Number(params.id);
  const token = locals.hermesToken!;
  try {
    const run = await readItem<{ id: number; job_name: string | null }>(token, 'agent_runs', { 'filter[id][_eq]': id, fields: 'id,job_name' });
    if (!run) return json(404, { error: 'Unknown result' });
    await updateItem(token, 'agent_runs', id, { checked_at: value });
    audit(value ? 'run_checked' : 'run_unchecked', { user: locals.hermesUser?.email, id, job: run.job_name });
    return json(200, { id, checkedAt: value });
  } catch {
    return json(502, { error: 'Could not save that' });
  }
}

export const POST: APIRoute = ({ params, locals }) => setChecked(params, locals, new Date().toISOString());
export const DELETE: APIRoute = ({ params, locals }) => setChecked(params, locals, null);
