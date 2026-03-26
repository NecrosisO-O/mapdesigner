FROM node:20-bookworm-slim AS build

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

RUN pnpm build

FROM node:20-bookworm-slim AS runtime

WORKDIR /app

ENV NODE_ENV=production
ENV PORT=3010
ENV MAPDESIGNER_ROOT=/data

COPY --from=build /app /app

RUN mkdir -p /data/storage/maps /data/storage/exports

VOLUME ["/data"]

EXPOSE 3010

CMD ["node", "apps/server/dist/apps/server/src/index.js"]
