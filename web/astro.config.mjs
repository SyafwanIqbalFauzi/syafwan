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
    routing: {
      prefixDefaultLocale: true,
      // `/` is handled by src/pages/index.astro (Accept-Language + cookie).
      redirectToDefaultLocale: false,
    },
  },
  // Secrets are read from the environment at runtime (not inlined at build),
  // so one Docker image works in every environment.
  env: {
    schema: {
      DIRECTUS_INTERNAL_URL: envField.string({ context: 'server', access: 'secret', default: 'http://localhost:8055' }),
      DIRECTUS_TOKEN: envField.string({ context: 'server', access: 'secret' }),
      // Read at runtime: a "public" field would be inlined at build time with the localhost default.
      PUBLIC_CMS_URL: envField.string({ context: 'server', access: 'secret', default: 'http://localhost:8055' }),
    },
  },
  // Single .env at the repo root, shared with docker-compose and the cms/ scripts.
  vite: {
    envDir: '..',
    // The native file watcher misses some edits/new files on Windows (seen under
    // src/pages/[lang]); polling is slower but reliable. Dev only.
    server: { watch: { usePolling: true, interval: 300 } },
  },
  server: { port: 4321, host: true },
});
