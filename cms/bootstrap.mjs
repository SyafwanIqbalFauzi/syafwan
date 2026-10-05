// Sets up what a schema snapshot does NOT carry: language rows, read permissions
// for the Public policy, and a read-only "web-reader" user whose static token the
// Astro server uses. Safe to re-run: every step checks before it writes.
import { randomBytes } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { adminApi, ENV_PATH } from './lib.mjs';

const api = await adminApi();

// --- 1. Languages ----------------------------------------------------------
const LANGUAGES = [
  { code: 'en-US', name: 'English', direction: 'ltr' },
  { code: 'id-ID', name: 'Bahasa Indonesia', direction: 'ltr' },
];
const existingLanguages = new Set((await api.get('/items/languages?fields=code')).map((l) => l.code));
for (const language of LANGUAGES) {
  if (existingLanguages.has(language.code)) continue;
  await api.post('/items/languages', language);
  console.log(`+ language ${language.code}`);
}

// --- 2. Read permissions ---------------------------------------------------
const published = { status: { _eq: 'published' } };
const parentPublished = (parent) => ({ [`${parent}_id`]: published });

/** collection -> row filter applied to public reads (null = every row). */
const READ_RULES = {
  languages: null,
  profile: null,
  profile_translations: null,
  experiences: published,
  experiences_translations: parentPublished('experiences'),
  experiences_projects: null,
  projects: published,
  projects_translations: parentPublished('projects'),
  posts: published,
  posts_translations: parentPublished('posts'),
  education: published,
  education_translations: parentPublished('education'),
  certifications: published,
  skills: published,
  skills_translations: parentPublished('skills'),
  directus_files: null,
};

async function grantReads(policyId, label) {
  const current = await api.get(
    `/permissions?filter[policy][_eq]=${policyId}&filter[action][_eq]=read&fields=id,collection&limit=-1`,
  );
  const byCollection = new Map(current.map((p) => [p.collection, p.id]));
  for (const [collection, filter] of Object.entries(READ_RULES)) {
    const permission = { policy: policyId, collection, action: 'read', fields: ['*'], permissions: filter, validation: null };
    if (byCollection.has(collection)) {
      await api.patch(`/permissions/${byCollection.get(collection)}`, permission);
    } else {
      await api.post('/permissions', permission);
    }
  }
  console.log(`✓ read permissions -> ${label} (${Object.keys(READ_RULES).length} collections)`);
}

const [publicPolicy] = await api.get('/policies?filter[name][_eq]=$t:public_label&fields=id');
if (!publicPolicy) throw new Error('Public policy not found');
await grantReads(publicPolicy.id, 'Public');

// --- 3. Web reader role + user + static token -----------------------------
const READER_NAME = 'Web Reader';
const READER_EMAIL = 'web-reader@example.com';

let [readerPolicy] = await api.get(`/policies?filter[name][_eq]=${encodeURIComponent(READER_NAME)}&fields=id`);
if (!readerPolicy) {
  readerPolicy = await api.post('/policies', {
    name: READER_NAME,
    icon: 'menu_book',
    description: 'Read-only access used by the Astro server',
    app_access: false,
    admin_access: false,
  });
  console.log(`+ policy ${READER_NAME}`);
}
await grantReads(readerPolicy.id, READER_NAME);

let [readerRole] = await api.get(`/roles?filter[name][_eq]=${encodeURIComponent(READER_NAME)}&fields=id`);
if (!readerRole) {
  readerRole = await api.post('/roles', {
    name: READER_NAME,
    icon: 'menu_book',
    policies: { create: [{ policy: readerPolicy.id }] },
  });
  console.log(`+ role ${READER_NAME}`);
}

const envText = readFileSync(ENV_PATH, 'utf8');
const currentToken = envText.match(/^DIRECTUS_TOKEN=(.*)$/m)?.[1]?.trim();

let [reader] = await api.get(`/users?filter[email][_eq]=${encodeURIComponent(READER_EMAIL)}&fields=id`);
let token = currentToken;
if (!reader || !currentToken) {
  token = randomBytes(32).toString('base64url');
  const user = { first_name: 'Web', last_name: 'Reader', email: READER_EMAIL, role: readerRole.id, status: 'active', token };
  if (reader) {
    await api.patch(`/users/${reader.id}`, { token });
    console.log('~ web-reader token rotated');
  } else {
    reader = await api.post('/users', user);
    console.log('+ user web-reader');
  }
  const nextEnv = /^DIRECTUS_TOKEN=.*$/m.test(envText)
    ? envText.replace(/^DIRECTUS_TOKEN=.*$/m, `DIRECTUS_TOKEN=${token}`)
    : `${envText.trimEnd()}\nDIRECTUS_TOKEN=${token}\n`;
  writeFileSync(ENV_PATH, nextEnv);
  console.log('✓ DIRECTUS_TOKEN ditulis ke .env');
}

// Sanity check: the token can read, and cannot write.
const base = process.env.DIRECTUS_URL ?? 'http://localhost:8055';
const read = await fetch(`${base}/items/languages`, { headers: { Authorization: `Bearer ${token}` } });
const write = await fetch(`${base}/items/languages`, {
  method: 'POST',
  headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
  body: JSON.stringify({ code: 'xx-XX', name: 'test' }),
});
console.log(`✓ token check: read ${read.status}, write ${write.status} (expected 200 / 403)`);
if (read.status !== 200 || write.status !== 403) process.exit(1);
