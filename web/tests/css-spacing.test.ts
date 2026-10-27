// Spacing in the CMS stylesheets comes from the scale (tokens in styles/cms-layout.css and global.css), not from
// hand-typed pixel values. Ratchet: the allow-list can only shrink.
import assert from 'node:assert/strict';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import test from 'node:test';

const SRC = new URL('../src/', import.meta.url).pathname;

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    return statSync(path).isDirectory() ? walk(path) : [path];
  });
}

const PRIVATE_DIRS = ['pages/agent/', 'pages/finance/', 'pages/accounts/', 'pages/sejarahpersib/'];
const PRIVATE_FILES = ['components/HermesSidebar.astro', 'components/FilterBar.astro', 'components/TypeTabs.astro', 'components/ClaudeUsage.astro', 'layouts/HermesShell.astro'];

export const cmsFiles = walk(SRC)
  .map((path) => relative(SRC, path))
  .filter((p) => p.startsWith('styles/cms/') || p === 'styles/cms-layout.css' || PRIVATE_FILES.includes(p) || (PRIVATE_DIRS.some((d) => p.startsWith(d)) && p.endsWith('.astro')));

const DECL = /\b(margin|padding|gap|row-gap|column-gap)(?:-(?:top|right|bottom|left|block|inline|block-start|block-end|inline-start|inline-end))?\s*:\s*([^;{}"]+)(?:;|(?=[}"]))/g;

/** px literals used for spacing that are not 0, 1 or 2 (hairlines) and not inside calc/min/max/clamp/env. */
export function offScale(css: string): string[] {
  const out: string[] = [];
  const text = css.replace(/\/\*[\s\S]*?\*\//g, '');
  const blocks = text.includes('<style') ? [...text.matchAll(/<style[^>]*>([\s\S]*?)<\/style>/g)].map((m) => m[1]) : [text];
  // inline style="..." attributes in markup count too
  for (const m of text.matchAll(/style="([^"]*)"/g)) blocks.push(m[1]);
  for (const block of blocks) {
    for (const m of block.matchAll(DECL)) {
      if (/(calc|min|max|clamp|env)\(/.test(m[2])) continue;
      const literal = [...m[2].matchAll(/(?<![\w.-])(\d+(?:\.\d+)?)px/g)].some((px) => ![0, 1, 2].includes(Number(px[1])));
      if (literal) out.push(m[0].trim());
    }
  }
  return out;
}

/** Remaining exceptions, by file. Only ever remove entries. */
const ALLOWED: Record<string, number> = {};

test('the CMS file list is found', () => {
  assert.ok(cmsFiles.length > 20, `expected the CMS stylesheets and pages, found ${cmsFiles.length}`);
  assert.ok(cmsFiles.includes('styles/cms/dialog.css'));
  assert.ok(cmsFiles.includes('pages/sejarahpersib/feedback.astro'));
});

test('no hand-typed spacing px outside the scale in CMS styles', () => {
  const problems: string[] = [];
  for (const file of cmsFiles) {
    const found = offScale(readFileSync(join(SRC, file), 'utf8'));
    const allowed = ALLOWED[file] ?? 0;
    if (found.length > allowed) problems.push(`${file}: ${found.length} (allowed ${allowed}) e.g. ${found.slice(0, 3).join(' | ')}`);
  }
  assert.deepEqual(problems, [], 'use var(--s-4|8|11|15|22|33|66) or a --gap-/--pad- token');
});

test('offScale reads inline style attributes', () => {
  assert.deepEqual(offScale('<p style="margin-top: 22px">x</p>'), ['margin-top: 22px']);
  assert.deepEqual(offScale('<p style="margin-top: var(--s-22)">x</p>'), []);
});

test('offScale spots literals and ignores tokens, hairlines and calc()', () => {
  assert.deepEqual(offScale('a{padding: 10px 12px; gap: var(--s-8); margin: 0 0 1px; padding-inline: calc(100% - 12px);}'), ['padding: 10px 12px;']);
  assert.deepEqual(offScale('<style>.x{margin-top:6px}</style><p style="margin:5px">'), ['margin-top:6px']);
  assert.deepEqual(offScale('/* margin: 9px; */ .y{gap: 4px}'), ['gap: 4px']);
});
