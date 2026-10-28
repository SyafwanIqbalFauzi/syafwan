// Marks one agent result as looked at (POST) or puts it back (DELETE) on /sejarahpersib.
// Only `checked_at` is written; the same-origin rule for mutations is enforced by the middleware.
import type { APIRoute } from 'astro';
import { audit } from '../../../../../lib/auth';
import { readItem, readItems, updateItem } from '../../../../../lib/directus-user';
import { DUPLICATE_WINDOW_MS, findTwins, type RunRow } from '../../../../../lib/updates';

export const prerender = false;

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' } });

async function setChecked(params: Record<string, string | undefined>, locals: App.Locals, value: string | null) {
  if (!params.id || !/^\d{1,9}$/.test(params.id)) return json(404, { error: 'Unknown result' });
  const id = Number(params.id);
  const token = locals.hermesToken!;
  try {
    const fields = 'id,job_id,job_name,execution_id,summary,started_at';
    const run = await readItem<RunRow>(token, 'agent_runs', { 'filter[id][_eq]': id, fields });
    if (!run) return json(404, { error: 'Unknown result' });
    await updateItem(token, 'agent_runs', id, { checked_at: value });
    // The same run can be stored twice (`file:` copy); the feed shows one, the badge counts both: keep them in step.
    // Best effort: the row the owner clicked is already saved.
    try {
      const at = Date.parse(run.started_at ?? '');
      if (run.job_id && Number.isFinite(at)) {
        const near = await readItems<RunRow>(token, 'agent_runs', {
          'filter[job_id][_eq]': run.job_id,
          'filter[started_at][_gte]': new Date(at - DUPLICATE_WINDOW_MS).toISOString(),
          'filter[started_at][_lte]': new Date(at + DUPLICATE_WINDOW_MS).toISOString(),
          limit: 20,
          fields,
        });
        for (const twin of findTwins(run, near.data)) await updateItem(token, 'agent_runs', twin.id, { checked_at: value });
      }
    } catch {
      /* ignore */
    }
    audit(value ? 'run_checked' : 'run_unchecked', { user: locals.hermesUser?.email, id, job: run.job_name });
    return json(200, { id, checkedAt: value });
  } catch {
    return json(502, { error: 'Could not save that' });
  }
}

export const POST: APIRoute = ({ params, locals }) => setChecked(params, locals, new Date().toISOString());
export const DELETE: APIRoute = ({ params, locals }) => setChecked(params, locals, null);
