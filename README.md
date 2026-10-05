# syafwan

Personal website of Syafwan Iqbal Fauzi: an Astro (SSR) frontend reading from a Directus CMS.

```
web/                    Astro app (output: server, @astrojs/node)
cms/                    Directus schema (schema/snapshot.yaml) + setup scripts
scripts/import-brains/  One-time importer: Obsidian vault -> Directus REST API
```

## Database

Directus uses **Supabase Postgres** (session pooler). Connection settings are read from `.env`
(`SUPABASE_DB_*`). `docker-compose.supabase.yml` overrides the Directus service to use them.
The local Postgres in `docker-compose.dev.yml` is kept as an offline copy (`npm run cms:local-db`)
but Directus does not use it by default. Uploaded files are still on `cms/uploads/` (local volume).

## Local development

Requirements: Node 22+, Docker.

```bash
cp .env.example .env        # fill in random secrets + admin email/password
npm install
npm run cms:up              # Postgres + Directus at http://localhost:8055/admin
npm run cms:apply           # create collections from cms/schema/snapshot.yaml
npm run cms:bootstrap       # languages, read permissions, web-reader token -> .env
npm run dev                 # Astro at http://localhost:4321
```

`cms:bootstrap` is idempotent; re-run it any time.

## Importing content (one-time)

Content was imported once from the Obsidian vault; Directus is the source of truth afterwards.

```bash
npm run import -- --dry-run --out payload.json   # parse the vault, review the payload
npm run import                                   # create missing items (never overwrites)
npm run import:translations -- file.json         # add id-ID translations to existing items
```

Set `BRAINS_DIR` to point at the vault (default `G:/My Drive/[999] Brains`) and
`DIRECTUS_URL` to choose the target instance. Translation files are working files and are not committed.

## Changing the schema

1. Edit collections/fields in the Directus UI (local).
2. `npm run cms:snapshot` to write `cms/schema/snapshot.yaml`.
3. Commit the snapshot. Other environments run `npm run cms:apply`.

`cms/init-schema.mjs` generated the very first schema on an empty Directus and is kept
for reference only. The snapshot is the source of truth.

## Scripts

| Script | What it does |
|---|---|
| `npm run dev` | Astro dev server |
| `npm run build` | Production build of `web/` |
| `npm run cms:up` / `cms:down` | Start / stop the local Directus stack |
| `npm run cms:logs` | Follow Directus logs |
| `npm run cms:snapshot` | Export the schema to `cms/schema/snapshot.yaml` |
| `npm run cms:apply` | Apply the snapshot, then restart Directus so it reloads its schema cache |
| `npm run cms:bootstrap` | Seed languages, Public + Web Reader read permissions, web-reader token |
| `npm run import` | Import the Obsidian vault (`--dry-run` to only parse) |
| `npm run import:translations` | Apply a translations JSON (default `id-ID`) |

## Frontend

- Pages live in `web/src/pages/[lang]/` (`en`, `id`); `/` redirects by cookie or `Accept-Language`.
- Data comes from Directus at request time, cached in memory for 60s (`web/src/lib/directus.ts`), so edits
  appear within a minute without a rebuild.
- Design tokens (teenage.engineering-inspired) are CSS variables in `web/src/styles/global.css`; components use scoped `<style>`.

## Access model

- Only published rows are readable without login (`status = published`); translations follow their parent's status.
- The Astro server uses the static token of the `web-reader` user (read-only, same rules as Public).
- `DIRECTUS_TOKEN` and other secrets are read at runtime through `astro:env`, never inlined into the build.
