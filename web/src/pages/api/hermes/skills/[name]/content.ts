// Ask for the instructions (SKILL.md body) of one of your skills to be replaced. The text sent is
// the redacted copy the page showed; the VPS merges the edit into the real file line by line, so
// hidden values (secrets, ids, credential paths) can never be overwritten. See apply_skill_changes.py.
import type { APIRoute } from 'astro';
import { loadSkill, MAX_CONTENT, requestChange } from '../../../../../lib/skill-requests';

export const prerender = false;

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

export const POST: APIRoute = async ({ params, request, locals }) => {
  const name = params.name ?? '';
  const body = await request.json().catch(() => null);
  const content = body?.content;
  const baseHash = body?.base_hash;
  if (typeof content !== 'string' || typeof baseHash !== 'string' || !/^[0-9a-f]{64}$/.test(baseHash)) return json(400, { error: 'Invalid request' });
  if (content.length > MAX_CONTENT) return json(400, { error: 'The text is too long (limit 60,000 characters)' });
  if (content.includes('\u0000')) return json(400, { error: 'The text contains invalid characters' });

  const token = locals.hermesToken!;
  let skill;
  try {
    skill = await loadSkill(token, name);
  } catch {
    return json(502, { error: 'Could not read the skill catalogue' });
  }
  if (!skill) return json(404, { error: 'Unknown skill' });
  if (!skill.editable) return json(400, { error: skill.source === 'builtin' ? 'Built-in skills are read-only' : 'This skill cannot be edited safely from the website' });
  // Fast check; the VPS repeats it against the real file.
  if (skill.body_hash !== baseHash) return json(409, { error: 'This skill changed after you opened it. Reload the page and edit the new version.' });

  const result = await requestChange(token, locals.hermesUser?.email, { skill: name, action: 'set_content', payload: { content_md: content }, base_hash: baseHash });
  return result.ok ? json(202, { id: result.id }) : json(result.status, { error: result.error });
};
