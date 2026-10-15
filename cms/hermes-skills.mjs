// Adds the `agent_skills` collection (a read-only mirror of the Hermes skill catalogue, filled
// by the VPS sync script) and lets the "Hermes Sync" policy read/create/update it. Not readable
// by Public. Safe to re-run.
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

const FIELDS = [
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
  field('synced_at', 'timestamp', { interface: 'datetime' }),
];

const collections = new Set((await api.get('/collections?limit=-1')).map((c) => c.collection));
if (collections.has('agent_skills')) {
  console.log('= collection agent_skills');
} else {
  await api.post('/collections', {
    collection: 'agent_skills',
    meta: { icon: 'extension', note: 'Mirror of the Hermes skill catalogue (synced from the VPS).' },
    schema: {},
    fields: FIELDS,
  });
  console.log('+ collection agent_skills');
}

const [policy] = await api.get(`/policies?filter[name][_eq]=${encodeURIComponent('Hermes Sync')}&fields=id`);
if (!policy) throw new Error('Policy "Hermes Sync" not found: run cms/hermes-sync.mjs first');
const current = await api.get(`/permissions?filter[policy][_eq]=${policy.id}&filter[collection][_eq]=agent_skills&fields=id,action&limit=-1`);
for (const action of ['read', 'create', 'update']) {
  if (current.some((p) => p.action === action)) continue;
  await api.post('/permissions', { policy: policy.id, collection: 'agent_skills', action, fields: ['*'], permissions: {}, validation: {} });
  console.log(`+ permission ${action} agent_skills`);
}

const anon = await fetch(`${(process.env.DIRECTUS_URL ?? 'http://localhost:8055').replace(/\/$/, '')}/items/agent_skills?limit=1`).then((r) => r.status);
console.log(`${anon === 403 ? '✓' : '✗'} anonymous read agent_skills: ${anon} (expected 403)`);
if (anon !== 403) process.exit(1);
