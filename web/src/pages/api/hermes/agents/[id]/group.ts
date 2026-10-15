// Sets the group an agent is listed under. Served locally (not proxied to Hermes): the group
// lives in Directus (agent_jobs.agent_group) and is written with the signed-in user's own token.
import type { APIRoute } from 'astro';
import { audit } from '../../../../../lib/auth';
import { readItem, updateItem, type AgentJob } from '../../../../../lib/directus-user';
import { normalizeGroup } from '../../../../../lib/groups';

export const prerender = false;

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

export const POST: APIRoute = async ({ params, request, locals }) => {
  const id = params.id ?? '';
  if (!/^[A-Za-z0-9_.:-]{1,128}$/.test(id)) return json(404, { error: 'Unknown agent' });

  const body = await request.json().catch(() => null);
  const group = normalizeGroup(body?.group);
  if (!group) return json(400, { error: 'Group must be 1–40 characters, without < or >' });

  const token = locals.hermesToken!;
  try {
    const job = await readItem<AgentJob>(token, 'agent_jobs', { 'filter[job_id][_eq]': id });
    if (!job) return json(404, { error: 'Unknown agent' });
    await updateItem(token, 'agent_jobs', job.id, { agent_group: group });
  } catch {
    return json(502, { error: 'Could not save the group' });
  }
  audit('agent_group', { user: locals.hermesUser?.email, job: id, group });
  return json(200, { group });
};
