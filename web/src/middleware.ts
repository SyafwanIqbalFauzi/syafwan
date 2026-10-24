import { defineMiddleware } from 'astro:middleware';
import { authenticate } from './lib/auth';

const isPrivate = (path: string) => path === '/agent' || path.startsWith('/agent/') || path.startsWith('/api/agent/') || path === '/finance' || path.startsWith('/finance/') || path.startsWith('/api/finance/');
const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

/** Sign-in page that sends the person back to where they were going afterwards. */
const loginUrl = (path: string) => (path === '/agent' ? '/agent/login' : `/agent/login?next=${encodeURIComponent(path)}`);

const json = (status: number, error: string) =>
  new Response(JSON.stringify({ error }), {
    status,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'private, no-store' },
  });

/** Mutations must come from this site: the Origin header has to match the configured origin. */
function sameOrigin(origin: string | null, siteOrigin: string): boolean {
  return origin !== null && origin === siteOrigin;
}

export const onRequest = defineMiddleware(async (context, next) => {
  const { pathname } = context.url;
  const siteOrigin = (context.site ?? new URL(context.url.origin)).origin;
  const secure = siteOrigin.startsWith('https:');

  // The area used to live under /hermes. Keep old bookmarks and links working (308 keeps the method too).
  if (pathname === '/hermes' || pathname.startsWith('/hermes/')) {
    return context.redirect(`/agent${pathname.slice('/hermes'.length)}${context.url.search}`, 308);
  }

  // The Autoplay Blocker extension links to /autoplay-blocker (its manifest homepage); the page lives under work.
  // Also short links to its privacy policy and report form (the form is a GET page; its POST goes to the long URL).
  const abShort = pathname.replace(/\/$/, '').match(/^\/autoplay-blocker(\/(privacy|report))?$/);
  if (abShort) {
    return context.redirect(`/en/work/autoplay-blocker${abShort[1] ?? ''}${context.url.search}`, 308);
  }

  // Finance used to be a part of the agent area; it is its own area now.
  if (pathname === '/agent/finance' || pathname.startsWith('/agent/finance/')) {
    return context.redirect(`/finance${pathname.slice('/agent/finance'.length)}${context.url.search}`, 308);
  }
  if (pathname.startsWith('/api/agent/finance/')) {
    return context.redirect(`/api/finance${pathname.slice('/api/agent/finance'.length)}${context.url.search}`, 308);
  }

  // Applies site-wide. Astro's own check is off (see astro.config.mjs).
  if (!SAFE_METHODS.has(context.request.method) && !sameOrigin(context.request.headers.get('origin'), siteOrigin)) {
    return json(403, 'Cross-origin request blocked');
  }

  if (isPrivate(pathname)) {
    const isApi = pathname.startsWith('/api/');
    const isLogin = pathname === '/agent/login';

    if (!isLogin) {
      const session = await authenticate(context.cookies, secure);
      if (!session) return isApi ? json(401, 'Not signed in') : context.redirect(loginUrl(pathname), 302);
      context.locals.hermesUser = session.user;
      context.locals.hermesToken = session.access;
    }

    const response = await next();
    response.headers.set('Cache-Control', 'private, no-store');
    response.headers.set('X-Robots-Tag', 'noindex, nofollow');
    return response;
  }

  // Public pages are rendered per request from Directus (cached in memory for 60s). Let a
  // reverse proxy / CDN reuse them briefly too, and serve stale while revalidating.
  const response = await next();
  const type = response.headers.get('content-type') ?? '';
  if (context.request.method === 'GET' && response.status === 200 && !response.headers.has('cache-control')) {
    if (type.includes('text/html') || type.includes('xml') || type.includes('text/plain')) {
      response.headers.set('Cache-Control', 'public, max-age=0, s-maxage=60, stale-while-revalidate=300');
    }
  }
  return response;
});
