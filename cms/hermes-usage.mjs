// Directus side of the Claude plan usage card. Safe to re-run.
//   - `claude_usage` : one row per usage window (session = 5 hours, weekly, ...), filled by the VPS
//                      script scripts/hermes/sync_claude_usage.py. Only percentages and reset times.
// Not readable by Public. The "Hermes Sync" policy may read, create, update and delete rows.
//
//   DIRECTUS_URL=https://syafwan.com/panel DIRECTUS_ADMIN_EMAIL=... DIRECTUS_ADMIN_PASSWORD=... \
//   [DIRECTUS_ADMIN_OTP=123456] node cms/hermes-usage.mjs
import { adminApi } from './lib.mjs';

const api = await adminApi();

const field = (name, type, meta = {}, schema = {}) => ({ field: name, type, meta: { interface: 'input', ...meta }, schema });

const COLLECTION = 'claude_usage';
const FIELDS = [
  { field: 'id', type: 'integer', meta: { hidden: true, readonly: true, interface: 'input' }, schema: { is_primary_key: true, has_auto_increment: true } },
  field('window', 'string', { required: true, note: 'session | weekly | weekly_opus | weekly_sonnet' }, { is_unique: true, is_nullable: false }),
  field('percent', 'float', { note: 'Share of the plan limit used, 0 to 100' }),
  field('severity', 'string', { note: 'normal | warning | critical' }),
  field('resets_at', 'timestamp', { interface: 'datetime' }),
  field('checked_at', 'timestamp', { interface: 'datetime', note: 'When the VPS last read the numbers' }),
];

const existing = new Set((await api.get('/collections?limit=-1')).map((c) => c.collection));
if (!existing.has(COLLECTION)) {
  await api.post('/collections', { collection: COLLECTION, meta: { icon: 'speed', note: 'Claude plan usage windows (synced from the VPS).' }, schema: {}, fields: FIELDS });
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
