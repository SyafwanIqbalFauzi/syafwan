// Directus side of the /agent area history (see sync_agent_runs.py on the VPS):
//   1. collections `agent_runs` and `agent_jobs`
//   2. a "Hermes Sync" policy that may only read/create/update those two collections
//   3. a user "hermes-sync" whose static token the VPS script uses
// Both collections have NO Public permissions; the web reads them with the signed-in
// administrator's own token. Safe to re-run: every step checks before it writes.
//
//   HERMES_SYNC_TOKEN=<token> DIRECTUS_URL=https://syafwan.com/panel \
//   DIRECTUS_ADMIN_EMAIL=... DIRECTUS_ADMIN_PASSWORD=... node cms/hermes-sync.mjs
import { adminApi } from './lib.mjs';

const token = process.env.HERMES_SYNC_TOKEN;
if (!token || token.length < 32) throw new Error('HERMES_SYNC_TOKEN (>= 32 chars) is required');

const api = await adminApi();

const field = (name, type, meta = {}, schema = {}) => ({ field: name, type, meta: { interface: 'input', ...meta }, schema });
const pk = () => ({
  field: 'id',
  type: 'integer',
  meta: { hidden: true, readonly: true, interface: 'input' },
  schema: { is_primary_key: true, has_auto_increment: true },
});
const json = (name) => field(name, 'json', { interface: 'input-code', options: { language: 'json' } });
const dropdown = (name, choices) =>
  field(name, 'string', { interface: 'select-dropdown', options: { choices: choices.map((v) => ({ text: v, value: v })) } });

const COLLECTIONS = {
  agent_runs: {
    meta: { icon: 'smart_toy', note: 'One row per Hermes cron execution, synced from the VPS. Response text is secret-redacted.', sort_field: null },
    fields: [
      pk(),
      field('execution_id', 'string', { required: true }, { is_unique: true, is_nullable: false }),
      field('job_id', 'string', { required: true }, { is_nullable: false }),
      field('job_name', 'string'),
      dropdown('kind', ['agent', 'script']),
      json('skills'),
      field('model', 'string'),
      dropdown('status', ['completed', 'failed', 'unknown']),
      field('scheduled_at', 'timestamp', { interface: 'datetime' }),
      field('started_at', 'timestamp', { interface: 'datetime' }),
      field('finished_at', 'timestamp', { interface: 'datetime' }),
      field('duration_s', 'float'),
      json('delivery'),
      field('summary', 'text', { interface: 'input-multiline' }),
      field('response_md', 'text', { interface: 'input-multiline' }),
      field('error', 'text', { interface: 'input-multiline' }),
      // /sejarahpersib: the agent asked for a look (PERLU-CEK line), and when the owner marked it as checked.
      // Also added to an existing collection by cms/hermes-persib.mjs.
      field('needs_check', 'boolean', { interface: 'boolean' }, { default_value: false }),
      field('check_reason', 'text', { interface: 'input-multiline' }),
      field('checked_at', 'timestamp', { interface: 'datetime' }),
    ],
  },
  agent_jobs: {
    meta: { icon: 'event_repeat', note: 'Snapshot of ~/.hermes/cron/jobs.json (metadata only, no prompts).', sort_field: null },
    fields: [
      pk(),
      field('job_id', 'string', { required: true }, { is_unique: true, is_nullable: false }),
      field('name', 'string'),
      dropdown('kind', ['agent', 'script']),
      json('skills'),
      field('model', 'string'),
      field('schedule_display', 'string'),
      field('state', 'string'),
      field('enabled', 'boolean', { interface: 'boolean' }),
      json('deliver_labels'),
      field('last_status', 'string'),
      field('last_run_at', 'timestamp', { interface: 'datetime' }),
      field('next_run_at', 'timestamp', { interface: 'datetime' }),
      field('synced_at', 'timestamp', { interface: 'datetime' }),
    ],
  },
};

// --- 1. Collections --------------------------------------------------------
const existing = new Set((await api.get('/collections?limit=-1')).map((c) => c.collection));
for (const [collection, def] of Object.entries(COLLECTIONS)) {
  if (existing.has(collection)) {
    console.log(`= collection ${collection}`);
    continue;
  }
  await api.post('/collections', { collection, meta: def.meta, schema: {}, fields: def.fields });
  console.log(`+ collection ${collection}`);
}

// --- 2. Policy -------------------------------------------------------------
const POLICY = 'Hermes Sync';
let [policy] = await api.get(`/policies?filter[name][_eq]=${encodeURIComponent(POLICY)}&fields=id`);
if (!policy) {
  policy = await api.post('/policies', {
    name: POLICY,
    icon: 'sync',
    description: 'Used by the VPS script that mirrors Hermes cron history. Only agent_runs and agent_jobs.',
    app_access: false,
    admin_access: false,
  });
  console.log(`+ policy ${POLICY}`);
}
const current = await api.get(`/permissions?filter[policy][_eq]=${policy.id}&fields=id,collection,action&limit=-1`);
for (const collection of Object.keys(COLLECTIONS)) {
  for (const action of ['read', 'create', 'update']) {
    if (current.some((p) => p.collection === collection && p.action === action)) continue;
    await api.post('/permissions', { policy: policy.id, collection, action, fields: ['*'], permissions: {}, validation: {} });
    console.log(`+ permission ${action} ${collection}`);
  }
}

// --- 3. Role + user --------------------------------------------------------
let [role] = await api.get(`/roles?filter[name][_eq]=${encodeURIComponent(POLICY)}&fields=id`);
if (!role) {
  role = await api.post('/roles', { name: POLICY, icon: 'sync', policies: { create: [{ policy: policy.id }] } });
  console.log(`+ role ${POLICY}`);
}
const EMAIL = 'hermes-sync@example.com';
const [user] = await api.get(`/users?filter[email][_eq]=${encodeURIComponent(EMAIL)}&fields=id`);
if (user) {
  await api.patch(`/users/${user.id}`, { token, status: 'active', role: role.id });
  console.log('~ user hermes-sync token set');
} else {
  await api.post('/users', { first_name: 'Hermes', last_name: 'Sync', email: EMAIL, role: role.id, status: 'active', token });
  console.log('+ user hermes-sync');
}

// --- 4. Sanity checks (token is never printed) ------------------------------
const base = (process.env.DIRECTUS_URL ?? 'http://localhost:8055').replace(/\/$/, '');
const call = (path, init = {}) =>
  fetch(`${base}${path}`, { ...init, headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' } }).then((r) => r.status);
const checks = [
  ['read agent_runs', await call('/items/agent_runs?limit=1'), 200],
  ['read agent_jobs', await call('/items/agent_jobs?limit=1'), 200],
  ['read profile (must be denied)', await call('/items/profile?limit=1'), 403],
  ['read users (must be denied)', await call('/users?limit=1'), 403],
];
let ok = true;
for (const [name, got, want] of checks) {
  console.log(`${got === want ? '✓' : '✗'} ${name}: ${got} (expected ${want})`);
  ok &&= got === want;
}
// Public must not see the collections.
const anon = await fetch(`${base}/items/agent_runs?limit=1`).then((r) => r.status);
console.log(`${anon === 403 ? '✓' : '✗'} anonymous read agent_runs: ${anon} (expected 403)`);
if (!ok || anon !== 403) process.exit(1);
