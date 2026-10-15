// Ask for a skill to be enabled or disabled. The VPS applies it within about a minute.
import type { APIRoute } from 'astro';
import { loadSkill, requestChange } from '../../../../../lib/skill-requests';

export const prerender = false;

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

export const POST: APIRoute = async ({ params, request, locals }) => {
  const name = params.name ?? '';
  const body = await request.json().catch(() => null);
  if (typeof body?.enabled !== 'boolean') return json(400, { error: 'Invalid request' });

  const token = locals.hermesToken!;
  let skill;
  try {
    skill = await loadSkill(token, name);
  } catch {
    return json(502, { error: 'Could not read the skill catalogue' });
  }
  if (!skill) return json(404, { error: 'Unknown skill' });
  if (skill.essential) return json(400, { error: 'This skill is essential for Hermes and cannot be disabled' });
  if ((skill.enabled !== false) === body.enabled) return json(200, { unchanged: true });

  const result = await requestChange(token, locals.hermesUser?.email, { skill: name, action: 'set_enabled', payload: { enabled: body.enabled } });
  return result.ok ? json(202, { id: result.id }) : json(result.status, { error: result.error });
};
