// The CMS standard: a change, a tab or a filter never reloads the whole page (see scripts/live.ts).
// These checks fail when a script goes back to location.reload() or a document-level listener starts
// editing the attribute it was matched on.
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { test } from 'node:test';

const SCRIPTS = new URL('../src/scripts/', import.meta.url).pathname;
const files = readdirSync(SCRIPTS).filter((name) => name.endsWith('.ts'));

test('only live.ts may reload the page (as its fallback)', () => {
  for (const name of files) {
    const text = readFileSync(SCRIPTS + name, 'utf8');
    const code = text.split('\n').filter((line) => !line.trim().startsWith('//') && !line.trim().startsWith('*'));
    const hits = code.filter((line) => /location\.reload\(/.test(line));
    if (name === 'live.ts') assert.equal(hits.length, 1, 'live.ts keeps exactly one fallback reload');
    else assert.deepEqual(hits, [], `${name} must call refresh() from ./live instead of location.reload()`);
  }
});

test('delegated handlers do not rewrite the data- attribute they were matched on', () => {
  // `delegate('click', '[data-x]', ...)` runs on the document; changing data-x inside the handler makes a second
  // delegate for the opposite action match the very same click.
  const text = readFileSync(SCRIPTS + 'persib-feedback.ts', 'utf8');
  assert.equal(/removeAttribute\('data-(un)?review'\)/.test(text), false);
});

test('the shell loads live.ts and the sidebar badges are swappable slots', () => {
  const shell = readFileSync(new URL('../src/layouts/HermesShell.astro', import.meta.url).pathname, 'utf8');
  assert.match(shell, /import '\.\.\/scripts\/live'/);
  assert.match(shell, /data-live=\{fill \? 'off'/);
  const side = readFileSync(new URL('../src/components/HermesSidebar.astro', import.meta.url).pathname, 'utf8');
  for (const slot of ['persib-rail', 'updates-badge', 'feedback-badge']) assert.match(side, new RegExp(`data-live-slot="${slot}"`));
});
