// Login for the private /agent area. Credentials are Directus accounts (so 2FA,
// password policy and reset live in one place), but the login page is our own and
// the browser never talks to Directus: the server exchanges the credentials and
// keeps the resulting tokens in httpOnly cookies.
import type { APIContext } from 'astro';
import { createHash } from 'node:crypto';
import { DIRECTUS_INTERNAL_URL } from 'astro:env/server';

/** Only users with this Directus role may enter. */
export const HERMES_ROLE = 'Administrator';
const ACCESS_COOKIE = 'hermes_at';
const REFRESH_COOKIE = 'hermes_rt';
const REFRESH_MAX_AGE = 7 * 24 * 3600; // Directus default refresh-token lifetime
const WHOAMI_TTL_MS = 30_000;

export interface HermesUser {
  id: string;
  email: string;
}

interface Tokens {
  access: string;
  refresh: string;
  /** Access-token lifetime in seconds. */
  expiresIn: number;
}

export type LoginResult = { ok: true; user: HermesUser; tokens: Tokens } | { ok: false; reason: 'invalid' | 'otp' | 'unavailable' };

async function directusJson(path: string, init: RequestInit): Promise<{ status: number; body: any }> {
  const res = await fetch(`${DIRECTUS_INTERNAL_URL}${path}`, {
    ...init,
    headers: { 'Content-Type': 'application/json', ...init.headers },
    signal: AbortSignal.timeout(10_000),
  });
  const body = await res.json().catch(() => null);
  return { status: res.status, body };
}

const toTokens = (data: any): Tokens | null =>
  data?.access_token && data?.refresh_token
    ? { access: data.access_token, refresh: data.refresh_token, expiresIn: Math.max(60, Math.floor((data.expires ?? 900_000) / 1000)) }
    : null;

/** Checks a token against Directus and confirms the user holds the Hermes role. */
const whoamiCache = new Map<string, { until: number; user: HermesUser | null }>();

async function whoami(access: string): Promise<HermesUser | null> {
  const key = createHash('sha256').update(access).digest('hex');
  const hit = whoamiCache.get(key);
  if (hit && hit.until > Date.now()) return hit.user;

  let user: HermesUser | null = null;
  try {
    const { status, body } = await directusJson('/users/me?fields=id,email,status,role.name', {
      headers: { Authorization: `Bearer ${access}` },
    });
    const me = body?.data;
    if (status === 200 && me?.status === 'active' && me?.role?.name === HERMES_ROLE) user = { id: me.id, email: me.email };
    else if (status >= 500) return null; // do not cache an outage
  } catch {
    return null;
  }
  if (whoamiCache.size > 200) whoamiCache.clear();
  whoamiCache.set(key, { until: Date.now() + WHOAMI_TTL_MS, user });
  return user;
}

export async function login(email: string, password: string, otp: string): Promise<LoginResult> {
  try {
    const { status, body } = await directusJson('/auth/login', {
      method: 'POST',
      body: JSON.stringify({ email, password, ...(otp ? { otp } : {}), mode: 'json' }),
    });
    if (status >= 500) return { ok: false, reason: 'unavailable' };
    const tokens = status === 200 ? toTokens(body?.data) : null;
    if (!tokens) {
      // Directus answers INVALID_OTP only after the password was accepted, and it says so on its
      // own public /auth/login too, so naming it here gives away nothing new and saves a lot of guessing.
      const code = body?.errors?.[0]?.extensions?.code;
      return { ok: false, reason: code === 'INVALID_OTP' ? 'otp' : 'invalid' };
    }
    const user = await whoami(tokens.access);
    if (!user) {
      // Valid Directus account, but not allowed in here: drop the session we just opened.
      await logoutTokens(tokens.refresh);
      return { ok: false, reason: 'invalid' };
    }
    return { ok: true, user, tokens };
  } catch {
    return { ok: false, reason: 'unavailable' };
  }
}

async function logoutTokens(refresh: string): Promise<void> {
  await directusJson('/auth/logout', { method: 'POST', body: JSON.stringify({ refresh_token: refresh, mode: 'json' }) }).catch(() => {});
}

type Cookies = APIContext['cookies'];

function cookieOptions(secure: boolean, maxAge: number) {
  return { httpOnly: true, secure, sameSite: 'strict' as const, path: '/', maxAge };
}

export function setSession(cookies: Cookies, tokens: Tokens, secure: boolean): void {
  cookies.set(ACCESS_COOKIE, tokens.access, cookieOptions(secure, tokens.expiresIn));
  cookies.set(REFRESH_COOKIE, tokens.refresh, cookieOptions(secure, REFRESH_MAX_AGE));
}

export async function clearSession(cookies: Cookies): Promise<void> {
  const refresh = cookies.get(REFRESH_COOKIE)?.value;
  cookies.delete(ACCESS_COOKIE, { path: '/' });
  cookies.delete(REFRESH_COOKIE, { path: '/' });
  if (refresh) await logoutTokens(refresh);
}

/** Resolves the signed-in user from cookies, refreshing the access token when it has expired. */
export interface Session {
  user: HermesUser;
  /** The user's own Directus access token, used to read agent_runs / agent_jobs. */
  access: string;
}

export async function authenticate(cookies: Cookies, secure: boolean): Promise<Session | null> {
  const access = cookies.get(ACCESS_COOKIE)?.value;
  if (access) {
    const user = await whoami(access);
    if (user) return { user, access };
  }
  const refresh = cookies.get(REFRESH_COOKIE)?.value;
  if (!refresh) return null;
  try {
    const { status, body } = await directusJson('/auth/refresh', {
      method: 'POST',
      body: JSON.stringify({ refresh_token: refresh, mode: 'json' }),
    });
    const tokens = status === 200 ? toTokens(body?.data) : null;
    if (!tokens) return null;
    const user = await whoami(tokens.access);
    if (!user) return null;
    setSession(cookies, tokens, secure);
    return { user, access: tokens.access };
  } catch {
    return null;
  }
}

/** One JSON line per security-relevant event, picked up by `docker logs`. */
export function audit(event: string, fields: Record<string, unknown> = {}): void {
  console.info(JSON.stringify({ ts: new Date().toISOString(), scope: 'hermes', event, ...fields }));
}
