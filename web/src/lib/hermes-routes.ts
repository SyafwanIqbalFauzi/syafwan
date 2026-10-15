// Allowlist of Hermes API endpoints reachable through /api/hermes/*. The browser
// never talks to Hermes directly and never picks the upstream path: every request
// is matched against this table, so the proxy cannot be used to reach anything else
// (the Hermes API server can run terminal commands).

export interface HermesRoute {
  /** Upstream path on the Hermes API server. */
  target: string;
  /** Response is a Server-Sent Events stream and must not be buffered. */
  stream: boolean;
  /** Assistant messages in the JSON response get a sanitized `html` field rendered from markdown. */
  render: boolean;
}

// Session and run ids are opaque tokens; keep them to a safe character set so they
// can be dropped into a path without escaping tricks.
const ID = '([A-Za-z0-9_.:-]{1,128})';

interface Rule {
  method: string;
  pattern: RegExp;
  build: (m: RegExpMatchArray) => string;
  stream?: boolean;
  render?: boolean;
}

const RULES: Rule[] = [
  { method: 'GET', pattern: /^capabilities$/, build: () => '/v1/capabilities' },
  { method: 'GET', pattern: /^health$/, build: () => '/health/detailed' },
  { method: 'GET', pattern: /^skills$/, build: () => '/v1/skills' },
  { method: 'GET', pattern: /^toolsets$/, build: () => '/v1/toolsets' },
  { method: 'GET', pattern: /^models$/, build: () => '/api/model/options' },

  { method: 'GET', pattern: /^sessions$/, build: () => '/api/sessions' },
  { method: 'POST', pattern: /^sessions$/, build: () => '/api/sessions' },
  { method: 'GET', pattern: new RegExp(`^sessions/${ID}$`), build: (m) => `/api/sessions/${m[1]}` },
  { method: 'PATCH', pattern: new RegExp(`^sessions/${ID}$`), build: (m) => `/api/sessions/${m[1]}` },
  { method: 'DELETE', pattern: new RegExp(`^sessions/${ID}$`), build: (m) => `/api/sessions/${m[1]}` },
  {
    method: 'GET',
    pattern: new RegExp(`^sessions/${ID}/messages$`),
    build: (m) => `/api/sessions/${m[1]}/messages`,
    render: true,
  },
  { method: 'POST', pattern: new RegExp(`^sessions/${ID}/fork$`), build: (m) => `/api/sessions/${m[1]}/fork` },
  {
    method: 'POST',
    pattern: new RegExp(`^sessions/${ID}/chat/stream$`),
    build: (m) => `/api/sessions/${m[1]}/chat/stream`,
    stream: true,
  },

  { method: 'POST', pattern: new RegExp(`^runs/${ID}/stop$`), build: (m) => `/v1/runs/${m[1]}/stop` },
  { method: 'POST', pattern: new RegExp(`^runs/${ID}/approval$`), build: (m) => `/v1/runs/${m[1]}/approval` },

  { method: 'GET', pattern: /^jobs$/, build: () => '/api/jobs' },
  { method: 'POST', pattern: /^jobs$/, build: () => '/api/jobs' },
  { method: 'GET', pattern: new RegExp(`^jobs/${ID}$`), build: (m) => `/api/jobs/${m[1]}` },
  { method: 'PATCH', pattern: new RegExp(`^jobs/${ID}$`), build: (m) => `/api/jobs/${m[1]}` },
  { method: 'DELETE', pattern: new RegExp(`^jobs/${ID}$`), build: (m) => `/api/jobs/${m[1]}` },
  { method: 'POST', pattern: new RegExp(`^jobs/${ID}/(pause|resume|run)$`), build: (m) => `/api/jobs/${m[1]}/${m[2]}` },
];

/** `path` is the part after `/api/hermes/`, without a leading or trailing slash. */
export function resolveHermesRoute(method: string, path: string): HermesRoute | null {
  const verb = method.toUpperCase();
  for (const rule of RULES) {
    if (rule.method !== verb) continue;
    const match = path.match(rule.pattern);
    if (match) return { target: rule.build(match), stream: rule.stream === true, render: rule.render === true };
  }
  return null;
}
