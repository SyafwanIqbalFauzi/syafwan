// Creates the Directus role + policy that guards the private /hermes area, and
// optionally one user in it. Safe to re-run: every step checks before it writes.
//
//   node cms/hermes-role.mjs                         # role + policy only
//   HERMES_USER_PASSWORD=... node cms/hermes-role.mjs --user you@example.com
//
// The policy grants NO data permissions. `app_access` is on only so the user can open
// /panel/admin once and enrol 2FA; `enforce_tfa` makes Directus refuse everything else
// until they do, which also blocks /hermes sign-in (web/src/lib/auth.ts) until then.
import { adminApi } from './lib.mjs';

const NAME = 'hermes-admin';
const api = await adminApi();

// --- 1. Role ---------------------------------------------------------------
let [role] = await api.get(`/roles?filter[name][_eq]=${NAME}&fields=id&limit=1`);
if (!role) {
  role = await api.post('/roles', { name: NAME, icon: 'smart_toy', description: 'Access to the private /hermes area (no content permissions).' });
  console.log(`+ role ${NAME}`);
}

// --- 2. Policy (no data permissions) ---------------------------------------
let [policy] = await api.get(`/policies?filter[name][_eq]=${NAME}&fields=id&limit=1`);
if (!policy) {
  policy = await api.post('/policies', {
    name: NAME,
    icon: 'smart_toy',
    description: 'Sign-in for /hermes only. Intentionally has no permissions.',
    admin_access: false,
    app_access: true,
    enforce_tfa: true,
  });
  console.log(`+ policy ${NAME}`);
}

// --- 3. Attach policy to role ----------------------------------------------
const linked = await api.get(`/access?filter[role][_eq]=${role.id}&filter[policy][_eq]=${policy.id}&fields=id&limit=1`);
if (!linked.length) {
  await api.post('/access', { role: role.id, policy: policy.id, sort: 1 });
  console.log('+ policy attached to role');
}

// --- 4. Optional user ------------------------------------------------------
const flag = process.argv.indexOf('--user');
if (flag !== -1) {
  const email = process.argv[flag + 1];
  const password = process.env.HERMES_USER_PASSWORD;
  if (!email || !password) throw new Error('--user needs an email argument and HERMES_USER_PASSWORD in the environment');
  const [existing] = await api.get(`/users?filter[email][_eq]=${encodeURIComponent(email)}&fields=id&limit=1`);
  if (existing) {
    console.log(`= user ${email} already exists (left untouched)`);
  } else {
    await api.post('/users', { email, password, role: role.id, status: 'active' });
    console.log(`+ user ${email}. Next: open /panel/admin once and enrol 2FA.`);
  }
}

console.log('done');
