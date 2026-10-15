// Where to go after signing in. Only our own private pages are allowed (no query, no other
// sites), so the "next" parameter cannot be used as an open redirect.

const ALLOWED = /^\/(agent|finance)(\/[A-Za-z0-9_-]+)*$/;

/** The page to open after sign-in: `next` when it is a private page of this site, otherwise the agent overview. */
export function safeNext(value: unknown): string {
  if (typeof value !== 'string' || value.length > 200) return '/agent';
  if (value === '/agent/login' || value === '/agent/logout') return '/agent';
  return ALLOWED.test(value) ? value : '/agent';
}
