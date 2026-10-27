// The CMS stylesheets must stay inside the CMS. These checks fail if a change would let CMS CSS reach the
// public landing pages (see plans/css-spacing-system-cms.md, "Batas lingkup").
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
const all = walk(SRC).map((path) => ({ path: relative(SRC, path), text: readFileSync(path, 'utf8') }));

test('global.css (shared with the landing pages) has no CMS selectors', () => {
  const css = all.find((f) => f.path === 'styles/global.css')!.text;
  for (const selector of ['.cms-main', '.cms-body', '.cms ', '.dlg', '.type-tab', '.page-head', '.palette', '.rail', '.toasts']) {
    assert.equal(css.includes(selector), false, `global.css must not contain ${selector}`);
  }
});

test('only HermesShell imports the CMS stylesheets', () => {
  const importers = all.filter((f) => /styles\/cms(\/|-layout)/.test(f.text) && /import\s+['"][^'"]*styles\/cms/.test(f.text)).map((f) => f.path);
  assert.deepEqual(importers, ['layouts/HermesShell.astro']);
});

test('public layout and components never pull in the CMS shell or its stylesheets', () => {
  const publicFiles = all.filter((f) => f.path === 'layouts/Layout.astro' || /^components\/(Nav|Footer|ProjectCard|PmIllustration)\.astro$/.test(f.path) || f.path.startsWith('pages/[lang]/'));
  assert.ok(publicFiles.length > 5);
  for (const file of publicFiles) {
    assert.equal(/HermesShell|styles\/cms|HermesSidebar|FilterBar/.test(file.text), false, `${file.path} must not use CMS code`);
  }
});

test('CMS tokens hang on body.cms-body, not :root', () => {
  const layout = all.find((f) => f.path === 'styles/cms-layout.css')!.text;
  assert.match(layout, /body\.cms-body\s*\{/);
  assert.equal(/:root/.test(layout.replace(/\/\*[\s\S]*?\*\//g, '')), false);
});
