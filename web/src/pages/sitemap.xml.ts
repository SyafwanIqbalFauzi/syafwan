import type { APIRoute } from 'astro';
import { getPosts, getProjects } from '../lib/content';
import { LOCALES } from '../lib/i18n';

export const GET: APIRoute = async ({ site, url }) => {
  const base = site ?? new URL(url.origin);
  const [projects, posts] = await Promise.all([getProjects(), getPosts()]);
  const paths = [
    '',
    '/about',
    '/work',
    '/writing',
    ...projects.map((p) => `/work/${p.slug}`),
    ...posts.map((p) => `/writing/${p.slug}`),
  ];

  const entry = (path: string) => {
    const links = LOCALES.map(
      (l) => `<xhtml:link rel="alternate" hreflang="${l}" href="${new URL(`/${l}${path}`, base).href}"/>`,
    ).join('');
    return LOCALES.map((l) => `<url><loc>${new URL(`/${l}${path}`, base).href}</loc>${links}</url>`).join('');
  };

  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:xhtml="http://www.w3.org/1999/xhtml">${paths.map(entry).join('')}</urlset>`;
  return new Response(xml, { headers: { 'Content-Type': 'application/xml; charset=utf-8' } });
};
