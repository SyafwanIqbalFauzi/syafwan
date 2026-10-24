// Sets up the Autoplay Blocker report form's storage in Directus. Safe to re-run: every step checks first.
//   1. the `autoplay_reports` collection (what people send from /work/autoplay-blocker/report)
//   2. a policy that may only CREATE rows in that collection (no read, update or delete)
//   3. a role + user "autoplay-reports" whose static token the Astro server uses (DIRECTUS_REPORT_TOKEN in .env)
// The token is written to .env and never printed. Run against the environment DIRECTUS_URL points at:
//   DIRECTUS_URL=https://syafwan.com/panel node cms/autoplay-reports-setup.mjs
import { randomBytes } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { adminApi, DIRECTUS_URL, ENV_PATH } from './lib.mjs';

const api = await adminApi();
const COLLECTION = 'autoplay_reports';
const NAME = 'Autoplay Reports';
const EMAIL = 'autoplay-reports@example.com';

// --- 1. Collection ---------------------------------------------------------
const collections = await api.get('/collections?limit=-1');
if (!collections.some((c) => c.collection === COLLECTION)) {
  await api.post('/collections', {
    collection: COLLECTION,
    meta: { icon: 'bug_report', note: 'Reports and questions sent from the Autoplay Blocker report form. Deleted after 12 months.', hidden: false, singleton: false },
    schema: {},
    fields: [
      { field: 'id', type: 'integer', meta: { hidden: true, readonly: true, interface: 'input' }, schema: { is_primary_key: true, has_auto_increment: true } },
      { field: 'date_created', type: 'timestamp', meta: { special: ['date-created'], interface: 'datetime', readonly: true, width: 'half' }, schema: {} },
      { field: 'status', type: 'string', meta: { interface: 'select-dropdown', width: 'half', options: { choices: [{ text: 'New', value: 'new' }, { text: 'Done', value: 'done' }] } }, schema: { default_value: 'new' } },
      { field: 'kind', type: 'string', meta: { interface: 'select-dropdown', width: 'half', options: { choices: [{ text: 'Site bug', value: 'site_bug' }, { text: 'Question', value: 'question' }, { text: 'Privacy', value: 'privacy' }] } }, schema: {} },
      { field: 'lang', type: 'string', meta: { interface: 'input', width: 'half' }, schema: {} },
      { field: 'site', type: 'string', meta: { interface: 'input', width: 'half' }, schema: {} },
      { field: 'version', type: 'string', meta: { interface: 'input', width: 'half' }, schema: {} },
      { field: 'message', type: 'text', meta: { interface: 'input-multiline', width: 'full' }, schema: {} },
      { field: 'email', type: 'string', meta: { interface: 'input', width: 'full' }, schema: {} },
    ],
  });
  console.log(`+ collection ${COLLECTION}`);
}

// --- 2. Create-only policy -------------------------------------------------
let [policy] = await api.get(`/policies?filter[name][_eq]=${encodeURIComponent(NAME)}&fields=id`);
if (!policy) {
  policy = await api.post('/policies', {
    name: NAME,
    icon: 'bug_report',
    description: 'Used by the Astro server to save Autoplay Blocker reports. Can only create rows in autoplay_reports.',
    app_access: false,
    admin_access: false,
  });
  console.log(`+ policy ${NAME}`);
}
const current = await api.get(`/permissions?filter[policy][_eq]=${policy.id}&fields=id,collection,action&limit=-1`);
if (!current.some((p) => p.collection === COLLECTION && p.action === 'create')) {
  await api.post('/permissions', {
    policy: policy.id,
    collection: COLLECTION,
    action: 'create',
    fields: ['kind', 'site', 'version', 'message', 'email', 'lang', 'status'],
    permissions: {},
    validation: {},
  });
  console.log(`+ permission create ${COLLECTION}`);
}
const extras = current.filter((p) => !(p.collection === COLLECTION && p.action === 'create'));
if (extras.length) console.warn(`! policy has ${extras.length} other permission(s); it should only have create on ${COLLECTION}`);

// --- 3. Role, user, static token ------------------------------------------
let [role] = await api.get(`/roles?filter[name][_eq]=${encodeURIComponent(NAME)}&fields=id`);
if (!role) {
  role = await api.post('/roles', { name: NAME, icon: 'bug_report', policies: { create: [{ policy: policy.id }] } });
  console.log(`+ role ${NAME}`);
}

const envText = readFileSync(ENV_PATH, 'utf8');
const currentToken = envText.match(/^DIRECTUS_REPORT_TOKEN=(.*)$/m)?.[1]?.trim();
let [user] = await api.get(`/users?filter[email][_eq]=${encodeURIComponent(EMAIL)}&fields=id`);
let token = currentToken;
if (!user || !currentToken) {
  token = randomBytes(32).toString('base64url');
  if (user) {
    await api.patch(`/users/${user.id}`, { token, status: 'active', role: role.id });
    console.log('~ autoplay-reports token rotated');
  } else {
    user = await api.post('/users', { first_name: 'Autoplay', last_name: 'Reports', email: EMAIL, role: role.id, status: 'active', token });
    console.log('+ user autoplay-reports');
  }
  const nextEnv = /^DIRECTUS_REPORT_TOKEN=.*$/m.test(envText)
    ? envText.replace(/^DIRECTUS_REPORT_TOKEN=.*$/m, `DIRECTUS_REPORT_TOKEN=${token}`)
    : `${envText.trimEnd()}\nDIRECTUS_REPORT_TOKEN=${token}\n`;
  writeFileSync(ENV_PATH, nextEnv);
  console.log('✓ DIRECTUS_REPORT_TOKEN written to .env (copy it to the server environment too)');
}

// --- Sanity checks: the token can neither read nor change anything; anonymous visitors cannot write. ---
const call = (path, init = {}, bearer = token) =>
  fetch(`${DIRECTUS_URL}${path}`, { ...init, headers: { ...(bearer ? { Authorization: `Bearer ${bearer}` } : {}), 'Content-Type': 'application/json' } }).then((r) => r.status);
const checks = [
  ['token reads reports (must be denied)', await call(`/items/${COLLECTION}?limit=1`), 403],
  ['token reads agent_runs (must be denied)', await call('/items/agent_runs?limit=1'), 403],
  ['token reads users (must be denied)', await call('/users?limit=1'), 403],
  ['anonymous creates a report (must be denied)', await call(`/items/${COLLECTION}`, { method: 'POST', body: '{}' }, null), 403],
  ['anonymous reads reports (must be denied)', await call(`/items/${COLLECTION}?limit=1`, {}, null), 403],
];
let ok = true;
for (const [label, got, want] of checks) {
  console.log(`${got === want ? '✓' : '✗'} ${label}: ${got} (expected ${want})`);
  ok &&= got === want;
}
if (!ok) process.exit(1);
