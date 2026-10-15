// Adds `agent_group` to the agent_jobs collection (the group an agent is listed under on
// /hermes/agents). The VPS sync script fills it once for new jobs; after that it is edited
// from the website and never overwritten. Safe to re-run.
//
//   DIRECTUS_URL=https://syafwan.com/panel DIRECTUS_ADMIN_EMAIL=... DIRECTUS_ADMIN_PASSWORD=... \
//   [DIRECTUS_ADMIN_OTP=123456] node cms/hermes-agent-group.mjs
import { adminApi } from './lib.mjs';

const api = await adminApi();
const fields = await api.get('/fields/agent_jobs');
if (fields.some((f) => f.field === 'agent_group')) {
  console.log('= field agent_jobs.agent_group');
} else {
  await api.post('/fields/agent_jobs', {
    field: 'agent_group',
    type: 'string',
    meta: { interface: 'input', note: 'Group shown on /hermes/agents (e.g. "Sejarah Persib"). Set by the sync once, then edited on the website.' },
    schema: { is_nullable: true },
  });
  console.log('+ field agent_jobs.agent_group');
}
