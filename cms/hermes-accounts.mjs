// Directus side of the Accounts page. Safe to re-run.
//   - `connected_accounts` : one row per connected account (Google today, social media later), filled by the
//                            VPS script scripts/hermes/sync_accounts.py. Holds NO secrets: provider, address,
//                            status, granted scopes and timestamps only. Tokens stay on the VPS.
// Not readable by Public. The "Hermes Sync" policy may read, create, update and delete rows.
//
//   DIRECTUS_URL=https://syafwan.com/panel DIRECTUS_ADMIN_EMAIL=... DIRECTUS_ADMIN_PASSWORD=... \
//   [DIRECTUS_ADMIN_OTP=123456] node cms/hermes-accounts.mjs
import { adminApi } from './lib.mjs';

const api = await adminApi();

const field = (name, type, meta = {}, schema = {}) => ({ field: name, type, meta: { interface: 'input', ...meta }, schema });

const COLLECTION = 'connected_accounts';
const STATUSES = ['connected', 'revoked', 'mismatch', 'not_connected', 'error'];
const FIELDS = [
  { field: 'id', type: 'integer', meta: { hidden: true, readonly: true, interface: 'input' }, schema: { is_primary_key: true, has_auto_increment: true } },
  field('provider', 'string', { required: true, note: 'google | (instagram, x, ... later)' }, { is_nullable: false }),
  field('identifier', 'string', { required: true, note: 'Email address or handle of the account' }, { is_nullable: false }),
  field('label', 'string', { note: 'Display name, e.g. Main / Work' }),
  field(
    'status',
    'string',
    { interface: 'select-dropdown', options: { choices: STATUSES.map((value) => ({ text: value, value })) }, note: 'Result of the last check' },
    { is_nullable: false, default_value: 'not_connected' },
  ),
  field('scopes', 'json', { interface: 'tags', note: 'Permissions the account granted' }),
  field('detail', 'string', { note: 'Short reason when the status is not connected' }),
  field('checked_at', 'timestamp', { interface: 'datetime', note: 'When the VPS last checked this account' }),
  field('last_ok_at', 'timestamp', { interface: 'datetime', note: 'Last time the check succeeded' }),
];

const existing = new Set((await api.get('/collections?limit=-1')).map((c) => c.collection));
if (!existing.has(COLLECTION)) {
  await api.post('/collections', { collection: COLLECTION, meta: { icon: 'manage_accounts', note: 'Connected accounts and their status (synced from the VPS).' }, schema: {}, fields: FIELDS });
  console.log(`+ collection ${COLLECTION}`);
} else {
  const have = new Set((await api.get(`/fields/${COLLECTION}`)).map((f) => f.field));
  for (const f of FIELDS) {
    if (have.has(f.field)) continue;
    await api.post(`/fields/${COLLECTION}`, f);
    console.log(`+ field ${COLLECTION}.${f.field}`);
  }
  console.log(`= collection ${COLLECTION}`);
}

const [policy] = await api.get(`/policies?filter[name][_eq]=${encodeURIComponent('Hermes Sync')}&fields=id`);
if (!policy) throw new Error('Policy "Hermes Sync" not found: run cms/hermes-sync.mjs first');
const current = await api.get(`/permissions?filter[policy][_eq]=${policy.id}&fields=id,collection,action&limit=-1`);
for (const action of ['read', 'create', 'update', 'delete']) {
  if (current.some((p) => p.collection === COLLECTION && p.action === action)) continue;
  await api.post('/permissions', { policy: policy.id, collection: COLLECTION, action, fields: ['*'], permissions: {}, validation: {} });
  console.log(`+ permission ${action} ${COLLECTION}`);
}

const base = (process.env.DIRECTUS_URL ?? 'http://localhost:8055').replace(/\/$/, '');
const anon = await fetch(`${base}/items/${COLLECTION}?limit=1`).then((r) => r.status);
console.log(`${anon === 403 ? '✓' : '✗'} anonymous read ${COLLECTION}: ${anon} (expected 403)`);
if (anon !== 403) process.exit(1);
