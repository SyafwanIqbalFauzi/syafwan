// @ts-check
import { defineConfig, envField } from 'astro/config';
import node from '@astrojs/node';

export default defineConfig({
  site: process.env.PUBLIC_SITE_URL ?? 'http://localhost:4321',
  output: 'server',
  adapter: node({ mode: 'standalone' }),
  i18n: {
    locales: ['en', 'id'],
    defaultLocale: 'en',
    // Manual: Astro's automatic mode 404s every page outside /en and /id, which would
    // block the private /hermes area. Public pages validate `lang` themselves
    // (`isLocale` → rewrite to /404) and `/` is handled by src/pages/index.astro.
    routing: 'manual',
  },
  // Secrets are read from the environment at runtime (not inlined at build),
  // so one Docker image works in every environment.
  env: {
    schema: {
      DIRECTUS_INTERNAL_URL: envField.string({ context: 'server', access: 'secret', default: 'http://localhost:8055' }),
      DIRECTUS_TOKEN: envField.string({ context: 'server', access: 'secret' }),
      // Read at runtime: a "public" field would be inlined at build time with the localhost default.
      PUBLIC_CMS_URL: envField.string({ context: 'server', access: 'secret', default: 'http://localhost:8055' }),
      // Hermes API server on the VPS host (see src/lib/hermes.ts). The key never reaches the browser.
      HERMES_API_URL: envField.string({ context: 'server', access: 'secret', default: 'http://172.18.0.1:8642' }),
      HERMES_API_KEY: envField.string({ context: 'server', access: 'secret', optional: true }),
    },
  },
  // Behind Caddy the request URL does not always match the public origin, so Astro's
  // built-in form Origin check is replaced by src/middleware.ts, which compares the
  // Origin header with the configured site for every non-GET request.
  security: { checkOrigin: false },
  // Single .env at the repo root, shared with docker-compose and the cms/ scripts.
  vite: {
    envDir: '..',
    // The native file watcher misses some edits/new files on Windows (seen under
    // src/pages/[lang]); polling is slower but reliable. Dev only.
    server: { watch: { usePolling: true, interval: 300 } },
  },
  server: { port: 4321, host: true },
});
