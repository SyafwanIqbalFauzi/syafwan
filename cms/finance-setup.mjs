// Access for Hermes (Catat Money) to the finance_* collections:
//   1. a "Hermes Finance" policy that may only read/create/update finance_* (NO delete:
//      removing a transaction is a soft delete via `dihapus_pada`)
//   2. a role with that policy, and a user "hermes-finance" whose static token Hermes uses
// The collections themselves come from cms/finance-snapshot.py. Safe to re-run.
//
//   FINANCE_TOKEN=<token, >= 32 chars> DIRECTUS_URL=... DIRECTUS_ADMIN_EMAIL=... \
//   DIRECTUS_ADMIN_PASSWORD=... node cms/finance-setup.mjs
import { adminApi } from './lib.mjs';

const token = process.env.FINANCE_TOKEN;
if (!token || token.length < 32) throw new Error('FINANCE_TOKEN (>= 32 chars) is required');

const api = await adminApi();
const COLLECTIONS = ['finance_members', 'finance_categories', 'finance_transactions', 'finance_budgets'];
const POLICY = 'Hermes Finance';

let [policy] = await api.get(`/policies?filter[name][_eq]=${encodeURIComponent(POLICY)}&fields=id`);
if (!policy) {
  policy = await api.post('/policies', {
    name: POLICY,
    icon: 'payments',
    description: 'Used by Hermes to record Catat Money transactions. Only finance_* (no delete).',
    app_access: false,
    admin_access: false,
  });
  console.log(`+ policy ${POLICY}`);
}
const current = await api.get(`/permissions?filter[policy][_eq]=${policy.id}&fields=id,collection,action&limit=-1`);
for (const collection of COLLECTIONS) {
  for (const action of ['read', 'create', 'update']) {
    if (current.some((p) => p.collection === collection && p.action === action)) continue;
    await api.post('/permissions', { policy: policy.id, collection, action, fields: ['*'], permissions: {}, validation: {} });
    console.log(`+ permission ${action} ${collection}`);
  }
}

let [role] = await api.get(`/roles?filter[name][_eq]=${encodeURIComponent(POLICY)}&fields=id`);
if (!role) {
  role = await api.post('/roles', { name: POLICY, icon: 'payments', policies: { create: [{ policy: policy.id }] } });
  console.log(`+ role ${POLICY}`);
}
const EMAIL = 'hermes-finance@example.com';
const [user] = await api.get(`/users?filter[email][_eq]=${encodeURIComponent(EMAIL)}&fields=id`);
if (user) {
  await api.patch(`/users/${user.id}`, { token, status: 'active', role: role.id });
  console.log('~ user hermes-finance token set');
} else {
  await api.post('/users', { first_name: 'Hermes', last_name: 'Finance', email: EMAIL, role: role.id, status: 'active', token });
  console.log('+ user hermes-finance');
}

// Sanity checks (token is never printed).
const base = (process.env.DIRECTUS_URL ?? 'http://localhost:8055').replace(/\/$/, '');
const call = (path, init = {}) =>
  fetch(`${base}${path}`, { ...init, headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' } }).then((r) => r.status);
const checks = [
  ['read finance_transactions', await call('/items/finance_transactions?limit=1'), 200],
  ['read finance_categories', await call('/items/finance_categories?limit=1'), 200],
  ['read profile (must be denied)', await call('/items/profile?limit=1'), 403],
  ['read agent_runs (must be denied)', await call('/items/agent_runs?limit=1'), 403],
  ['read users (must be denied)', await call('/users?limit=1'), 403],
];
let ok = true;
for (const [name, got, want] of checks) {
  console.log(`${got === want ? '✓' : '✗'} ${name}: ${got} (expected ${want})`);
  ok &&= got === want;
}
for (const c of COLLECTIONS) {
  const anon = await fetch(`${base}/items/${c}?limit=1`).then((r) => r.status);
  console.log(`${anon === 403 ? '✓' : '✗'} anonymous read ${c}: ${anon} (expected 403)`);
  ok &&= anon === 403;
}
if (!ok) process.exit(1);
