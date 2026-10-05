// Adds translations (default id-ID) to items that already exist in Directus.
//
//   npm run import:translations -- <file.json> [--lang id-ID] [--force]
//
// The JSON file is a working file and is NOT committed; once applied, translations
// live in Directus only. Shape (every section optional):
// {
//   "profile":     { "headline": "...", "short_bio": "...", ... },
//   "projects":    { "<slug>": { "summary": "...", "body": "..." } },
//   "posts":       { "<slug>": { "title": "...", "excerpt": "...", "body": "..." } },
//   "experiences": { "<company>|<start_date>": { "role": "...", ... } },
//   "education":   { "<institution>": { "degree": "...", "description": "..." } },
//   "skills":      { "<English skill name>": { "name": "...", "keywords": ["..."] } }
// }
// Existing translations in the target language are left alone unless --force.
import { readFileSync } from 'node:fs';
import { adminApi } from '../../cms/lib.mjs';

const args = process.argv.slice(2);
const file = args.find((a) => !a.startsWith('--') && args[args.indexOf(a) - 1] !== '--lang');
const lang = args.includes('--lang') ? args[args.indexOf('--lang') + 1] : 'id-ID';
const force = args.includes('--force');
if (!file) throw new Error('Usage: npm run import:translations -- <file.json> [--lang id-ID] [--force]');

const input = JSON.parse(readFileSync(file, 'utf8'));
const api = await adminApi();
const stats = {};
const count = (collection, outcome) => {
  stats[collection] ??= { created: 0, updated: 0, skipped: 0, missing: 0 };
  stats[collection][outcome] += 1;
};

/** Upserts one translation on an item given its current translations list. */
async function apply(collection, path, translations, fields) {
  const current = translations.find((t) => t.languages_code === lang);
  if (current && !force) return count(collection, 'skipped');
  const change = current
    ? { update: [{ id: current.id, ...fields }] }
    : { create: [{ languages_code: lang, ...fields }] };
  await api.patch(path, { translations: change });
  count(collection, current ? 'updated' : 'created');
}

async function applyCollection(collection, entries, keyFields, keyOf) {
  if (!entries) return;
  const rows = await api.get(`/items/${collection}?fields=id,${keyFields},translations.id,translations.languages_code&limit=-1`);
  const byKey = new Map(rows.map((row) => [keyOf(row), row]));
  for (const [key, fields] of Object.entries(entries)) {
    const row = byKey.get(key);
    if (!row) {
      console.warn(`! ${collection}: no item for "${key}"`);
      count(collection, 'missing');
      continue;
    }
    await apply(collection, `/items/${collection}/${row.id}`, row.translations, fields);
  }
}

if (input.profile) {
  const profile = await api.get('/items/profile?fields=translations.id,translations.languages_code');
  await apply('profile', '/items/profile', profile?.translations ?? [], input.profile);
}
await applyCollection('projects', input.projects, 'slug', (r) => r.slug);
await applyCollection('posts', input.posts, 'slug', (r) => r.slug);
await applyCollection('experiences', input.experiences, 'company,start_date', (r) => `${r.company}|${r.start_date}`);
await applyCollection('education', input.education, 'institution', (r) => r.institution);
await applyCollection(
  'skills',
  input.skills,
  'translations.name',
  (r) => r.translations.find((t) => t.languages_code === 'en-US')?.name,
);

console.table(stats);
