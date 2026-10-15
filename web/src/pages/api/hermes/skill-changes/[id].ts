// Status of one skill change request (the page polls this until the VPS has applied it).
import type { APIRoute } from 'astro';
import { readItem, type SkillChange } from '../../../../lib/directus-user';

export const prerender = false;

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

export const GET: APIRoute = async ({ params, locals }) => {
  if (!/^\d{1,9}$/.test(params.id ?? '')) return json(404, { error: 'Unknown request' });
  try {
    const row = await readItem<SkillChange>(locals.hermesToken!, 'skill_changes', { 'filter[id][_eq]': params.id!, fields: 'id,skill,action,status,result,applied_at' });
    return row ? json(200, row) : json(404, { error: 'Unknown request' });
  } catch {
    return json(502, { error: 'Could not read the request' });
  }
};
