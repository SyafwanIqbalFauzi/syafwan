// Attach a skill to an agent, or detach it. Only the `skills` list is ever sent to Hermes, and the
// skill must exist in the synced catalogue and be enabled (detaching is always allowed).
import type { APIRoute } from 'astro';
import { audit } from '../../../../../lib/auth';
import { readItem, updateItem, type AgentJob, type AgentSkill } from '../../../../../lib/directus-user';
import { hermesGet, hermesRequest } from '../../../../../lib/hermes';
import { applyAssignment, SKILL_NAME } from '../../../../../lib/skills';

export const prerender = false;

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

export const POST: APIRoute = async ({ params, request, locals }) => {
  const skill = params.name ?? '';
  if (!SKILL_NAME.test(skill)) return json(404, { error: 'Unknown skill' });

  const body = await request.json().catch(() => null);
  const jobId = typeof body?.job_id === 'string' ? body.job_id : '';
  const action = body?.action;
  if (!/^[0-9a-f]{12}$/.test(jobId) || (action !== 'add' && action !== 'remove')) return json(400, { error: 'Invalid request' });

  const token = locals.hermesToken!;
  let row: AgentSkill | null;
  try {
    row = await readItem<AgentSkill>(token, 'agent_skills', { 'filter[name][_eq]': skill });
  } catch {
    return json(502, { error: 'Could not read the skill catalogue' });
  }
  if (!row || row.source === 'removed') return json(404, { error: 'Unknown skill' });
  if (action === 'add' && row.enabled === false) return json(400, { error: 'This skill is disabled in Hermes' });

  // Always start from what Hermes has right now, not from the website's copy.
  const live = await hermesGet<{ job: { skills?: string[]; no_agent?: boolean } }>(`/api/jobs/${jobId}`);
  if (!live?.job) return json(404, { error: 'Hermes does not know this agent' });
  if (live.job.no_agent) return json(400, { error: 'Scripts do not use skills' });

  const next = applyAssignment(live.job.skills ?? [], skill, action);
  if (!next) return json(400, { error: 'An agent can have at most 20 skills' });

  const result = await hermesRequest('PATCH', `/api/jobs/${jobId}`, { skills: next });
  if (!result.ok) {
    const message = result.json?.error?.message ?? result.json?.error ?? 'Hermes did not accept the change';
    return json(result.status >= 500 ? 502 : 400, { error: String(message).slice(0, 200) });
  }
  const saved: string[] = result.json?.job?.skills ?? next;
  audit('agent_skills', { user: locals.hermesUser?.email, job: jobId, skill, action });

  try {
    const jobRow = await readItem<AgentJob>(token, 'agent_jobs', { 'filter[job_id][_eq]': jobId });
    if (jobRow) await updateItem(token, 'agent_jobs', jobRow.id, { skills: saved });
  } catch {
    /* the next sync fixes the website's copy */
  }
  return json(200, { skills: saved });
};
