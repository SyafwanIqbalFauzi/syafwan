# Production image for the Astro web app (SSR, @astrojs/node standalone).
# Built from the repo root so npm workspaces resolve; only the built server ships.
FROM node:24-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
COPY web/package.json web/
COPY cms/package.json cms/
COPY scripts/import-brains/package.json scripts/import-brains/
RUN npm ci
COPY web web
RUN npm -w web run build \
 && npm prune --omit=dev

FROM node:24-alpine AS runtime
WORKDIR /app
ENV NODE_ENV=production HOST=0.0.0.0 PORT=4321
COPY --from=build /app/node_modules node_modules
COPY --from=build /app/web/dist web/dist
COPY --from=build /app/web/package.json web/package.json
USER node
EXPOSE 4321
HEALTHCHECK --interval=15s --timeout=5s --retries=5 --start-period=20s \
  CMD wget -qO- http://127.0.0.1:4321/en >/dev/null || exit 1
CMD ["node", "web/dist/server/entry.mjs"]
