# MapDesigner

MapDesigner is a local-first hex-map design tool for worldbuilding.

## Workspace Layout

- `apps/web`: React + Vite editor UI
- `apps/server`: Fastify API, file storage, PNG export, CLI
- `packages/map-core`: shared map rules, commands, validation, serialization
- `packages/map-render`: shared SVG rendering for UI and export
- `storage/maps`: persisted map JSON files
- `storage/exports`: exported PNG and JSON files

## Getting Started

```bash
pnpm install
pnpm dev:server
pnpm dev:web
```

The server defaults to `http://localhost:3010`.
