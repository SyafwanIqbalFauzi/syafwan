# Production image for the Astro web app (SSR, @astrojs/node standalone).
# Built from the repo root so npm workspaces resolve; only the built server ships.
FROM node:24-slim AS build
# Astro bakes `site` into the build (canonical/hreflang/OG URLs), so the public origin is a build arg.
ARG PUBLIC_SITE_URL=https://syafwan.sejarahpersib.com
ENV PUBLIC_SITE_URL=$PUBLIC_SITE_URL
WORKDIR /app
COPY package.json package-lock.json ./
COPY web/package.json web/
COPY cms/package.json cms/
COPY scripts/import-brains/package.json scripts/import-brains/
RUN npm ci
COPY web web
RUN npm -w web run build \
 && npm prune --omit=dev

FROM node:24-slim AS runtime
WORKDIR /app
ENV NODE_ENV=production HOST=0.0.0.0 PORT=4321
COPY --from=build /app/node_modules node_modules
COPY --from=build /app/web/dist web/dist
COPY --from=build /app/web/package.json web/package.json
USER node
EXPOSE 4321
HEALTHCHECK --interval=15s --timeout=5s --retries=5 --start-period=20s \
  CMD node -e "fetch('http://127.0.0.1:4321/en').then(r=>process.exit(r.ok?0:1),()=>process.exit(1))"
CMD ["node", "web/dist/server/entry.mjs"]
