// Directus side of connecting accounts from the website. Safe to re-run.
//   - `account_requests` : a request made on /accounts (start or finish connecting a Google account), written by the
//                          signed-in administrator, carried out by the VPS script scripts/hermes/apply_account_requests.py.
//                          `payload` briefly holds the pasted Google address (one-time code); the VPS clears it.
// Not readable by Public. The "Hermes Sync" policy may read and update rows (it never creates or deletes them).
//
//   DIRECTUS_URL=https://syafwan.com/panel DIRECTUS_ADMIN_EMAIL=... DIRECTUS_ADMIN_PASSWORD=... \
//   [DIRECTUS_ADMIN_OTP=123456] node cms/hermes-account-requests.mjs
import { adminApi } from './lib.mjs';

const api = await adminApi();

const field = (name, type, meta = {}, schema = {}) => ({ field: name, type, meta: { interface: 'input', ...meta }, schema });

const COLLECTION = 'account_requests';
const FIELDS = [
  { field: 'id', type: 'integer', meta: { hidden: true, readonly: true, interface: 'input' }, schema: { is_primary_key: true, has_auto_increment: true } },
  field('action', 'string', { required: true, interface: 'select-dropdown', options: { choices: [{ text: 'start', value: 'start' }, { text: 'finish', value: 'finish' }] } }, { is_nullable: false }),
  field('identifier', 'string', { required: true, note: 'Email address of the account' }, { is_nullable: false }),
  field('label', 'string', { note: 'Name for a new account' }),
  field('payload', 'text', { interface: 'input-multiline', note: 'Pasted Google address (one-time code); cleared by the VPS' }),
  field(
    'status',
    'string',
    { interface: 'select-dropdown', options: { choices: ['pending', 'done', 'failed'].map((value) => ({ text: value, value })) } },
    { is_nullable: false, default_value: 'pending' },
  ),
  field('result', 'text', { interface: 'input-multiline', note: 'Consent link for start, a message otherwise' }),
  field('requested_by', 'string'),
  field('requested_at', 'timestamp', { interface: 'datetime' }),
  field('applied_at', 'timestamp', { interface: 'datetime' }),
];

const existing = new Set((await api.get('/collections?limit=-1')).map((c) => c.collection));
if (!existing.has(COLLECTION)) {
  await api.post('/collections', { collection: COLLECTION, meta: { icon: 'link', note: 'Requests to connect Google accounts (made on /accounts, carried out by the VPS).' }, schema: {}, fields: FIELDS });
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
for (const action of ['read', 'update']) {
  if (current.some((p) => p.collection === COLLECTION && p.action === action)) continue;
  await api.post('/permissions', { policy: policy.id, collection: COLLECTION, action, fields: ['*'], permissions: {}, validation: {} });
  console.log(`+ permission ${action} ${COLLECTION}`);
}

const base = (process.env.DIRECTUS_URL ?? 'http://localhost:8055').replace(/\/$/, '');
const anon = await fetch(`${base}/items/${COLLECTION}?limit=1`).then((r) => r.status);
console.log(`${anon === 403 ? '✓' : '✗'} anonymous read ${COLLECTION}: ${anon} (expected 403)`);
if (anon !== 403) process.exit(1);
