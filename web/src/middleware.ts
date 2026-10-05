import { defineMiddleware } from 'astro:middleware';

// Pages are rendered per request from Directus (cached in memory for 60s). Let a
// reverse proxy / CDN reuse them briefly too, and serve stale while revalidating.
export const onRequest = defineMiddleware(async (context, next) => {
  const response = await next();
  const type = response.headers.get('content-type') ?? '';
  if (context.request.method === 'GET' && response.status === 200 && !response.headers.has('cache-control')) {
    if (type.includes('text/html') || type.includes('xml') || type.includes('text/plain')) {
      response.headers.set('Cache-Control', 'public, max-age=0, s-maxage=60, stale-while-revalidate=300');
    }
  }
  return response;
});
