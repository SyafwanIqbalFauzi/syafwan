import { PUBLIC_CMS_URL } from 'astro:env/server';
import type { DirectusFile } from './schema';

const WIDTHS = [480, 800, 1200, 1600];

/** URL of a Directus asset resized on the fly (Directus caches each variant). */
export function assetUrl(file: Pick<DirectusFile, 'id'> | string, width = 1200, format = 'webp'): string {
  const id = typeof file === 'string' ? file : file.id;
  return `${PUBLIC_CMS_URL}/assets/${id}?width=${width}&format=${format}&quality=80`;
}

export function assetSrcset(file: DirectusFile): string {
  const max = file.width ?? Infinity;
  const widths = WIDTHS.filter((w) => w <= max);
  return (widths.length ? widths : [WIDTHS[0]]).map((w) => `${assetUrl(file, w)} ${w}w`).join(', ');
}

/** Raw file (e.g. a PDF) for download. */
export const fileUrl = (file: Pick<DirectusFile, 'id'>) => `${PUBLIC_CMS_URL}/assets/${file.id}?download`;
