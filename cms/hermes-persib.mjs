// Adds the fields /sejarahpersib needs to the existing `agent_runs` collection:
//   related_links     links to what the result is about (set by sync_agent_runs.py)
//   followup_at / followup_session   the owner sent a follow-up instruction to Hermes (set by the web)
//   needs_check   the agent ended its answer with a PERLU-CEK line (set by sync_agent_runs.py)
//   check_reason  the text after PERLU-CEK:
//   checked_at    when the owner pressed "Mark as checked" (set by the web, with the owner's own token)
// Safe to re-run: a field that exists is left alone. Existing rows keep needs_check = false / null.
// (hermes-sync.mjs lists the same fields so a rebuilt schema has them too.)
//
//   DIRECTUS_URL=https://syafwan.com/panel DIRECTUS_ADMIN_EMAIL=... DIRECTUS_ADMIN_PASSWORD=... node cms/hermes-persib.mjs
import { adminApi } from './lib.mjs';

const api = await adminApi();

const FIELDS = [
  { field: 'needs_check', type: 'boolean', meta: { interface: 'boolean', note: 'The agent asked for a person to look at this result' }, schema: { default_value: false } },
  { field: 'check_reason', type: 'text', meta: { interface: 'input-multiline' }, schema: {} },
  { field: 'checked_at', type: 'timestamp', meta: { interface: 'datetime', note: 'When the owner marked this result as checked' }, schema: {} },
  // Links to what the result is about ([{label, url}], set by sync_agent_runs.py; [] = none found, null = not computed yet).
  { field: 'related_links', type: 'json', meta: { interface: 'input-code', options: { language: 'json' }, note: 'Links to what this result is about' }, schema: {} },
  // The owner sent a follow-up instruction to Hermes from /sejarahpersib (set by the web with the owner's token).
  { field: 'followup_at', type: 'timestamp', meta: { interface: 'datetime', note: 'When the owner last sent a follow-up instruction about this result' }, schema: {} },
  { field: 'followup_session', type: 'string', meta: { interface: 'input', note: 'Hermes chat session of that follow-up' }, schema: { max_length: 128 } },
];

const existing = new Set((await api.get('/fields/agent_runs')).map((f) => f.field));
for (const def of FIELDS) {
  if (existing.has(def.field)) {
    console.log(`= agent_runs.${def.field}`);
    continue;
  }
  await api.post('/fields/agent_runs', def);
  console.log(`+ agent_runs.${def.field}`);
}

// The Hermes Sync policy already allows read/create/update on agent_runs with fields ['*'], so the new
// fields are writable by the VPS script without a permission change. Check it instead of assuming.
const [policy] = await api.get(`/policies?filter[name][_eq]=${encodeURIComponent('Hermes Sync')}&fields=id`);
if (policy) {
  const perms = await api.get(`/permissions?filter[policy][_eq]=${policy.id}&filter[collection][_eq]=agent_runs&fields=action,fields&limit=-1`);
  for (const action of ['read', 'create', 'update']) {
    const p = perms.find((x) => x.action === action);
    const ok = p && (p.fields ?? []).includes('*');
    console.log(`${ok ? '✓' : '✗'} Hermes Sync may ${action} all agent_runs fields`);
    if (!ok) process.exitCode = 1;
  }
}
