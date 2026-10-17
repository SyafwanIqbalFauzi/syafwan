// Serves an image the agent mentioned in a reply (MEDIA:/path). Sign-in is enforced by the middleware.
// Only images inside the mounted folders are served (see lib/chat-media.ts); symlinks are resolved
// first so a link cannot lead out of them.
import type { APIRoute } from 'astro';
import { open, realpath } from 'node:fs/promises';
import { MAX_MEDIA_BYTES, MEDIA_ROOTS, resolveMediaPath } from '../../../lib/chat-media';

export const prerender = false;

const plain = (status: number, text: string) => new Response(text, { status, headers: { 'Content-Type': 'text/plain', 'Cache-Control': 'private, no-store' } });

export const GET: APIRoute = async ({ url }) => {
  const resolved = resolveMediaPath(url.searchParams.get('path'));
  if (!resolved) return plain(404, 'Not found');
  try {
    const real = await realpath(resolved.file);
    if (!MEDIA_ROOTS.some((root) => real.startsWith(root.mount))) return plain(404, 'Not found');
    const handle = await open(real, 'r');
    try {
      const info = await handle.stat();
      if (!info.isFile() || info.size > MAX_MEDIA_BYTES) return plain(404, 'Not found');
      const body = await handle.readFile();
      return new Response(new Uint8Array(body), {
        status: 200,
        headers: {
          'Content-Type': resolved.type,
          'Content-Length': String(body.length),
          'X-Content-Type-Options': 'nosniff',
          'Content-Security-Policy': "default-src 'none'; sandbox",
          'Cache-Control': 'private, max-age=3600',
        },
      });
    } finally {
      await handle.close();
    }
  } catch {
    return plain(404, 'Not found');
  }
};
