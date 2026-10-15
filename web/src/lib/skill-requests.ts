// Shared by the two skill-change routes. The website never edits skills itself: it records a
// request in Directus and a script on the VPS applies it after re-checking everything there.
import { audit } from './auth';
import { createItem, readItem, type AgentSkill, type SkillChange } from './directus-user';
import { SKILL_NAME } from './skills';

export const MAX_CONTENT = 60_000;

export type Outcome = { ok: true; id: number } | { ok: false; status: number; error: string };

/** The skill row if it exists, is not removed and the name is well-formed. */
export async function loadSkill(token: string, name: string): Promise<AgentSkill | null> {
  if (!SKILL_NAME.test(name)) return null;
  const row = await readItem<AgentSkill>(token, 'agent_skills', { 'filter[name][_eq]': name });
  return row && row.source !== 'removed' ? row : null;
}

/** One open request per skill: a second change must wait for the first to be applied. */
export async function hasPending(token: string, name: string): Promise<boolean> {
  const open = await readItem<SkillChange>(token, 'skill_changes', {
    'filter[skill][_eq]': name,
    'filter[status][_eq]': 'pending',
    fields: 'id',
  });
  return Boolean(open);
}

export async function requestChange(
  token: string,
  user: string | undefined,
  data: { skill: string; action: 'set_enabled' | 'set_content'; payload: Record<string, unknown>; base_hash?: string },
): Promise<Outcome> {
  try {
    if (await hasPending(token, data.skill)) {
      return { ok: false, status: 409, error: 'Another change to this skill is still waiting to be applied. Try again in a minute.' };
    }
    const created = await createItem<SkillChange>(token, 'skill_changes', {
      ...data,
      status: 'pending',
      requested_by: user ?? null,
      requested_at: new Date().toISOString(),
    });
    audit('skill_change', { user, skill: data.skill, action: data.action, id: created.id });
    return { ok: true, id: created.id };
  } catch {
    return { ok: false, status: 502, error: 'Could not record the request' };
  }
}
