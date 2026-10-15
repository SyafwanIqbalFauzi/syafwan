import type { APIRoute } from 'astro';
import { audit, clearSession } from '../../lib/auth';

export const prerender = false;

// POST only: a GET link could be triggered cross-site (e.g. by an <img> tag).
export const POST: APIRoute = async ({ cookies, locals, redirect }) => {
  audit('logout', { user: locals.hermesUser?.email });
  await clearSession(cookies);
  return redirect('/agent/login', 303);
};
