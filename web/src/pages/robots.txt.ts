import type { APIRoute } from 'astro';

export const GET: APIRoute = ({ site, url }) => {
  const base = site ?? new URL(url.origin);
  const body = ['User-agent: *', 'Allow: /', 'Disallow: /panel', '', `Sitemap: ${new URL('/sitemap.xml', base).href}`, ''].join('\n');
  return new Response(body, { headers: { 'Content-Type': 'text/plain; charset=utf-8' } });
};
