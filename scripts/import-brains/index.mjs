// One-time import: Obsidian vault -> Directus REST API.
//
//   npm run import -- --dry-run [--out file.json]   parse only, write the payload for review
//   npm run import                                   create missing items in DIRECTUS_URL
//
// Items that already exist (matched by slug or a natural key) are skipped, so edits
// made in Directus are never overwritten and re-running is harmless.
import { readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { adminApi, DIRECTUS_URL } from '../../cms/lib.mjs';
import { parseVault } from './parse.mjs';

const args = process.argv.slice(2);
const dryRun = args.includes('--dry-run');
const outPath = args.includes('--out') ? args[args.indexOf('--out') + 1] : join(tmpdir(), 'brains-import.json');
const BRAINS_DIR = process.env.BRAINS_DIR || 'G:/My Drive/[999] Brains';

const data = parseVault(BRAINS_DIR);

// Guard: the phone number must never leave the vault.
const serialized = JSON.stringify(data);
if (/0813|\+62\s?813|8132442/.test(serialized)) throw new Error('Phone number found in payload, aborting');

console.log(`Vault: ${BRAINS_DIR}`);
console.table({
  projects: data.projects.length,
  'projects with cover': data.projects.filter((p) => p.cover).length,
  experiences: data.experiences.length,
  posts: data.posts.length,
  education: data.education.length,
  certifications: data.certifications.length,
  skills: data.skills.length,
});

if (dryRun) {
  writeFileSync(outPath, JSON.stringify(data, null, 2));
  console.log(`Dry run: payload written to ${outPath}`);
  process.exit(0);
}

console.log(`Importing into ${DIRECTUS_URL} ...`);
const api = await adminApi();
const stats = {};
const count = (collection, outcome) => {
  stats[collection] ??= { created: 0, skipped: 0 };
  stats[collection][outcome] += 1;
};

// --- Files -----------------------------------------------------------------
async function ensureFolder(name) {
  const [found] = await api.get(`/folders?filter[name][_eq]=${encodeURIComponent(name)}&filter[parent][_null]=true`);
  return found?.id ?? (await api.post('/folders', { name })).id;
}

const fileIds = new Map();
async function uploadImage(fileName, folder) {
  if (fileIds.has(fileName)) return fileIds.get(fileName);
  const [existing] = await api.get(
    `/files?filter[filename_download][_eq]=${encodeURIComponent(fileName)}&fields=id&limit=1`,
  );
  let id = existing?.id;
  if (!id) {
    const form = new FormData();
    form.append('folder', folder);
    form.append('title', fileName.replace(/\.[^.]+$/, ''));
    const type = fileName.toLowerCase().endsWith('.png') ? 'image/png' : 'image/jpeg';
    form.append('file', new Blob([readFileSync(join(BRAINS_DIR, 'Files', fileName))], { type }), fileName);
    id = (await api.post('/files', form)).id;
    count('files', 'created');
  } else {
    count('files', 'skipped');
  }
  fileIds.set(fileName, id);
  return id;
}

// --- Helpers -----------------------------------------------------------------
async function existingKeys(collection, fields, keyOf) {
  const rows = await api.get(`/items/${collection}?fields=${fields}&limit=-1`);
  return new Map(rows.map((row) => [keyOf(row), row.id]));
}

async function createMissing(collection, items, { keyOf, existing, build = (item) => item }) {
  for (const item of items) {
    const key = keyOf(item);
    if (existing.has(key)) {
      count(collection, 'skipped');
      continue;
    }
    const created = await api.post(`/items/${collection}`, await build(item));
    existing.set(key, created.id);
    count(collection, 'created');
  }
  return existing;
}

// --- Projects (first: experiences link to them) ---------------------------
const portfolioFolder = await ensureFolder('portfolio');
const projectIds = await createMissing('projects', data.projects, {
  keyOf: (p) => p.slug,
  existing: await existingKeys('projects', 'id,slug', (p) => p.slug),
  build: async ({ cover, ...project }) => ({
    ...project,
    cover: cover ? await uploadImage(cover, portfolioFolder) : null,
  }),
});

// --- Experiences ------------------------------------------------------------
const experienceKey = (e) => `${e.company}|${e.start_date}`;
await createMissing('experiences', data.experiences, {
  keyOf: experienceKey,
  existing: await existingKeys('experiences', 'id,company,start_date', experienceKey),
  build: ({ projects, ...experience }) => {
    const missing = projects.filter((slug) => !projectIds.has(slug));
    if (missing.length) console.warn(`! ${experience.company}: unknown related projects ${missing.join(', ')}`);
    return {
      ...experience,
      projects: projects.filter((slug) => projectIds.has(slug)).map((slug) => ({ projects_id: projectIds.get(slug) })),
    };
  },
});

// --- Posts, education, certifications, skills ------------------------------
await createMissing('posts', data.posts, {
  keyOf: (p) => p.slug,
  existing: await existingKeys('posts', 'id,slug', (p) => p.slug),
});

await createMissing('education', data.education, {
  keyOf: (e) => e.institution,
  existing: await existingKeys('education', 'id,institution', (e) => e.institution),
});

await createMissing('certifications', data.certifications, {
  keyOf: (c) => c.name,
  existing: await existingKeys('certifications', 'id,name', (c) => c.name),
});

const skillName = (s) => s.translations.find((t) => t.languages_code === 'en-US')?.name;
await createMissing('skills', data.skills, {
  keyOf: skillName,
  existing: await existingKeys('skills', 'id,translations.languages_code,translations.name', skillName),
});

// --- Profile (singleton) ------------------------------------------------------
const profile = await api.get('/items/profile?fields=full_name');
if (profile?.full_name) {
  count('profile', 'skipped');
} else {
  await api.patch('/items/profile', data.profile);
  count('profile', 'created');
}

console.table(stats);
