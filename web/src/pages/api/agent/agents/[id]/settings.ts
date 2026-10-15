// Renames an agent and/or changes its schedule. Only these two fields are ever sent to Hermes,
// each validated here first; the Directus snapshot row is updated too so the list shows the
// change straight away (the 5-minute sync would also do it).
import type { APIRoute } from 'astro';
import { audit } from '../../../../../lib/auth';
import { readItem, updateItem, type AgentJob } from '../../../../../lib/directus-user';
import { hermesRequest } from '../../../../../lib/hermes';
import { normalizeJobName, validateSchedule } from '../../../../../lib/schedule-edit';

export const prerender = false;

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

export const POST: APIRoute = async ({ params, request, locals }) => {
  const id = params.id ?? '';
  if (!/^[0-9a-f]{12}$/.test(id)) return json(404, { error: 'Unknown agent' });

  const body = await request.json().catch(() => null);
  if (!body || typeof body !== 'object') return json(400, { error: 'Invalid request' });

  const update: { name?: string; schedule?: string } = {};
  if ('name' in body) {
    const name = normalizeJobName(body.name);
    if (!name) return json(400, { error: 'Name must be 1–80 characters, on one line, without < or >' });
    update.name = name;
  }
  if ('schedule' in body) {
    const schedule = typeof body.schedule === 'string' ? body.schedule.trim() : '';
    if (!validateSchedule(schedule)) return json(400, { error: 'That schedule is not valid' });
    update.schedule = schedule;
  }
  if (!update.name && !update.schedule) return json(400, { error: 'Nothing to change' });

  const result = await hermesRequest('PATCH', `/api/jobs/${id}`, update);
  if (!result.ok) {
    const message = result.json?.error?.message ?? result.json?.error ?? 'Hermes did not accept the change';
    return json(result.status === 404 ? 404 : result.status >= 500 ? 502 : 400, { error: String(message).slice(0, 200) });
  }

  const job = result.json?.job ?? result.json ?? {};
  audit('agent_settings', { user: locals.hermesUser?.email, job: id, changed: Object.keys(update), name: update.name, schedule: update.schedule });

  // Best effort: keep the website's copy in step. The next sync fixes it if this fails.
  try {
    const token = locals.hermesToken!;
    const row = await readItem<AgentJob>(token, 'agent_jobs', { 'filter[job_id][_eq]': id });
    if (row) {
      await updateItem(token, 'agent_jobs', row.id, {
        ...(update.name ? { name: job.name ?? update.name } : {}),
        ...(update.schedule ? { schedule_display: job.schedule_display ?? update.schedule, next_run_at: job.next_run_at ?? null } : {}),
      });
    }
  } catch {
    /* ignore */
  }

  return json(200, {
    name: job.name ?? update.name ?? null,
    schedule_display: job.schedule_display ?? update.schedule ?? null,
    next_run_at: job.next_run_at ?? null,
  });
};
