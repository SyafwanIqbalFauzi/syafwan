// Pictures the agent sends in a reply, written as `MEDIA:/absolute/path/to/file.png`.
// The agent writes the file on the VPS host; the web container sees a few host folders as read-only
// mounts (docker-compose.prod.yml). Only images inside those folders are ever served, nothing else.
// Pure functions (no file access) so they are unit-tested.
import { posix } from 'node:path';

export interface MediaRoot {
  /** Where the agent writes on the host. */
  host: string;
  /** Where the same folder is mounted inside the container. */
  mount: string;
}

export const MEDIA_ROOTS: MediaRoot[] = [
  { host: '/home/syafwan/.hermes/cache/scratch/', mount: '/media/scratch/' },
  { host: '/home/syafwan/.hermes/cache/images/', mount: '/media/images/' },
];

export const MEDIA_TYPES: Record<string, string> = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
};

export const MAX_MEDIA_BYTES = 8 * 1024 * 1024;

/**
 * Map a host path from a MEDIA tag to the path inside the container, or null when it is not an image
 * inside an allowed folder. Rejects `..`, NUL and anything that normalizes outside the folder.
 */
export function resolveMediaPath(hostPath: unknown, roots: MediaRoot[] = MEDIA_ROOTS): { file: string; type: string } | null {
  if (typeof hostPath !== 'string' || hostPath.length > 500 || hostPath.includes('\0') || hostPath.includes('\\')) return null;
  if (!posix.isAbsolute(hostPath) || hostPath.split('/').includes('..')) return null;
  const normalized = posix.normalize(hostPath);
  const type = MEDIA_TYPES[posix.extname(normalized).toLowerCase()];
  if (!type) return null;
  for (const root of roots) {
    if (normalized.startsWith(root.host) && normalized.length > root.host.length) {
      const file = root.mount + normalized.slice(root.host.length);
      if (posix.normalize(file).startsWith(root.mount)) return { file, type };
    }
  }
  return null;
}

const MEDIA_TAG = /MEDIA:(\/[^\s"'<>`)\]]+\.(?:png|jpe?g|gif|webp))/gi;

/** Replace the MEDIA tags that point at an allowed image with markdown images served by /api/agent/media. */
export function inlineMediaTags(text: string, roots: MediaRoot[] = MEDIA_ROOTS): string {
  if (!text.includes('MEDIA:')) return text;
  return text.replace(MEDIA_TAG, (whole, path: string) =>
    resolveMediaPath(path, roots) ? `![image](/api/agent/media?path=${encodeURIComponent(path)})` : whole,
  );
}
