FROM node:24.16.0-bookworm-slim AS build
ENV PNPM_HOME=/pnpm
ENV PATH=$PNPM_HOME:$PATH
RUN corepack enable
WORKDIR /app
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml tsconfig.base.json ./
COPY apps/server/package.json apps/server/package.json
COPY apps/web/package.json apps/web/package.json
COPY packages/map-core/package.json packages/map-core/package.json
COPY packages/map-render/package.json packages/map-render/package.json
RUN pnpm install --frozen-lockfile
COPY . .
RUN pnpm build && pnpm --filter @mapdesigner/server deploy --prod --legacy /out

FROM node:24.16.0-bookworm-slim AS runtime
ENV NODE_ENV=production
ENV HOST=0.0.0.0
ENV PORT=3010
ENV MAPDESIGNER_ROOT=/data
WORKDIR /app
RUN apt-get update && apt-get install -y --no-install-recommends fonts-dejavu-core fonts-noto-cjk && rm -rf /var/lib/apt/lists/*
COPY --from=build --chown=node:node /out /app
COPY --from=build --chown=node:node /app/apps/web/dist /app/apps/web/dist
RUN mkdir -p /data/storage/maps /data/storage/exports && chown -R node:node /data
USER node
VOLUME ["/data"]
EXPOSE 3010
HEALTHCHECK --interval=30s --timeout=5s --start-period=15s CMD node -e "fetch('http://127.0.0.1:3010/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "dist/apps/server/src/index.js"]
