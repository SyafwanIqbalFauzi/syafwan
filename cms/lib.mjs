// Shared helpers for scripts that talk to the Directus REST API as admin.
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

export const ROOT = fileURLToPath(new URL('..', import.meta.url));
export const ENV_PATH = `${ROOT}.env`;

if (existsSync(ENV_PATH)) process.loadEnvFile(ENV_PATH);

export function env(name, fallback) {
  const value = process.env[name] ?? fallback;
  if (value === undefined || value === '') throw new Error(`Missing env ${name} (see .env.example)`);
  return value;
}

export const DIRECTUS_URL = env('DIRECTUS_URL', 'http://localhost:8055').replace(/\/$/, '');

/** Logs in as the admin user and returns a small fetch wrapper bound to the access token. */
export async function adminApi() {
  const token =
    process.env.DIRECTUS_ADMIN_TOKEN ||
    (await login(env('DIRECTUS_ADMIN_EMAIL'), env('DIRECTUS_ADMIN_PASSWORD')));

  async function request(method, path, body) {
    const res = await fetch(`${DIRECTUS_URL}${path}`, {
      method,
      headers: {
        Authorization: `Bearer ${token}`,
        ...(body !== undefined && !(body instanceof FormData) ? { 'Content-Type': 'application/json' } : {}),
      },
      body: body === undefined ? undefined : body instanceof FormData ? body : JSON.stringify(body),
    });
    if (res.status === 204) return null;
    const json = await res.json().catch(() => null);
    if (!res.ok) {
      const message = json?.errors?.map((e) => e.message).join('; ') || res.statusText;
      const error = new Error(`${method} ${path} -> ${res.status}: ${message}`);
      error.status = res.status;
      throw error;
    }
    return json?.data ?? json;
  }

  return {
    get: (path) => request('GET', path),
    post: (path, body) => request('POST', path, body),
    patch: (path, body) => request('PATCH', path, body),
    del: (path) => request('DELETE', path),
  };
}

async function login(email, password) {
  const res = await fetch(`${DIRECTUS_URL}/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password }),
  });
  const json = await res.json().catch(() => null);
  if (!res.ok) throw new Error(`Login failed (${res.status}): ${json?.errors?.[0]?.message ?? res.statusText}`);
  return json.data.access_token;
}
