// Directus side of the Hermes skills pages. Safe to re-run.
//   - `agent_skills`  : read-only mirror of the skill catalogue (filled by the VPS sync script)
//   - `skill_changes` : change requests made on the website (enable/disable, edit instructions).
//                       The website only ADDS requests; a script on the VPS pulls them, re-validates
//                       and applies them, then writes the outcome back (status/result/applied_at).
// Neither collection is readable by Public. The "Hermes Sync" policy gets what it needs.
//
//   DIRECTUS_URL=https://syafwan.com/panel DIRECTUS_ADMIN_EMAIL=... DIRECTUS_ADMIN_PASSWORD=... \
//   [DIRECTUS_ADMIN_OTP=123456] node cms/hermes-skills.mjs
import { adminApi } from './lib.mjs';

const api = await adminApi();

const field = (name, type, meta = {}, schema = {}) => ({ field: name, type, meta: { interface: 'input', ...meta }, schema });
const pk = () => ({
  field: 'id',
  type: 'integer',
  meta: { hidden: true, readonly: true, interface: 'input' },
  schema: { is_primary_key: true, has_auto_increment: true },
});

const COLLECTIONS = {
  agent_skills: {
    meta: { icon: 'extension', note: 'Mirror of the Hermes skill catalogue (synced from the VPS).' },
    fields: [
      pk(),
      field('name', 'string', { required: true }, { is_unique: true, is_nullable: false }),
      field('category', 'string'),
      field('source', 'string', { note: 'builtin | local | hub | removed' }),
      field('description', 'text', { interface: 'input-multiline' }),
      field('version', 'string'),
      field('enabled', 'boolean', { interface: 'boolean' }),
      field('modified', 'boolean', { interface: 'boolean', note: 'A bundled skill that was edited locally' }),
      field('files', 'integer', { note: 'Number of files in the skill folder' }),
      field('content_md', 'text', { interface: 'input-multiline', note: 'SKILL.md without front matter, secret-redacted' }),
      field('content_hash', 'string'),
      field('body_hash', 'string', { note: 'sha256 of content_md; lets the VPS detect edits made since the page was opened' }),
      field('editable', 'boolean', { interface: 'boolean', note: 'May the instructions be edited from the website?' }),
      field('essential', 'boolean', { interface: 'boolean', note: 'Cannot be disabled (Hermes needs it)' }),
      field('synced_at', 'timestamp', { interface: 'datetime' }),
    ],
  },
  skill_changes: {
    meta: { icon: 'edit_note', note: 'Skill change requests from the website; applied by a script on the VPS.' },
    fields: [
      pk(),
      field('skill', 'string', { required: true }, { is_nullable: false }),
      field('action', 'string', { required: true, note: 'set_enabled | set_content' }, { is_nullable: false }),
      field('payload', 'json', { interface: 'input-code', options: { language: 'json' } }),
      field('base_hash', 'string', { note: 'body_hash of the text the edit started from' }),
      field('status', 'string', { required: true, note: 'pending | applied | failed | rejected' }, { is_nullable: false, default_value: 'pending' }),
      field('requested_by', 'string'),
      field('requested_at', 'timestamp', { interface: 'datetime' }),
      field('applied_at', 'timestamp', { interface: 'datetime' }),
      field('result', 'text', { interface: 'input-multiline' }),
    ],
  },
};

// --- collections + any missing fields --------------------------------------
const existing = new Set((await api.get('/collections?limit=-1')).map((c) => c.collection));
for (const [collection, def] of Object.entries(COLLECTIONS)) {
  if (!existing.has(collection)) {
    await api.post('/collections', { collection, meta: def.meta, schema: {}, fields: def.fields });
    console.log(`+ collection ${collection}`);
    continue;
  }
  const have = new Set((await api.get(`/fields/${collection}`)).map((f) => f.field));
  for (const f of def.fields) {
    if (have.has(f.field)) continue;
    await api.post(`/fields/${collection}`, f);
    console.log(`+ field ${collection}.${f.field}`);
  }
  console.log(`= collection ${collection}`);
}

// --- permissions for the VPS sync user ---------------------------------------
const [policy] = await api.get(`/policies?filter[name][_eq]=${encodeURIComponent('Hermes Sync')}&fields=id`);
if (!policy) throw new Error('Policy "Hermes Sync" not found: run cms/hermes-sync.mjs first');
const WANT = {
  agent_skills: ['read', 'create', 'update'],
  skill_changes: ['read', 'update'], // never create: only the website asks for changes
};
const current = await api.get(`/permissions?filter[policy][_eq]=${policy.id}&fields=id,collection,action&limit=-1`);
for (const [collection, actions] of Object.entries(WANT)) {
  for (const action of actions) {
    if (current.some((p) => p.collection === collection && p.action === action)) continue;
    await api.post('/permissions', { policy: policy.id, collection, action, fields: ['*'], permissions: {}, validation: {} });
    console.log(`+ permission ${action} ${collection}`);
  }
}

// --- checks -----------------------------------------------------------------
const base = (process.env.DIRECTUS_URL ?? 'http://localhost:8055').replace(/\/$/, '');
let ok = true;
for (const collection of Object.keys(COLLECTIONS)) {
  const anon = await fetch(`${base}/items/${collection}?limit=1`).then((r) => r.status);
  console.log(`${anon === 403 ? '✓' : '✗'} anonymous read ${collection}: ${anon} (expected 403)`);
  ok &&= anon === 403;
}
if (!ok) process.exit(1);
