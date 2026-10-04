# MapDesigner

[![Version](https://img.shields.io/badge/version-0.3.0--rc.2-2563eb)](./package.json)
[![Node.js](https://img.shields.io/badge/node-24-339933)](https://nodejs.org/)
[![pnpm](https://img.shields.io/badge/pnpm-10-f69220)](https://pnpm.io/)
[![License: GPL v3](https://img.shields.io/badge/license-GPLv3-dc2626.svg)](./LICENSE)

[简体中文说明](./README.zh-CN.md)

When building a fictional world, the map often changes along with the setting. Coastlines shift, regions are redefined, climates are adjusted, and what began as a simple sketch can quickly turn into a messy mix of images and notes. MapDesigner is a local-first hex map design tool for keeping that process editable, structured, and easier to maintain.

It combines a visual WebUI with a structured CLI, so the same map can evolve alongside the worldbuilding process. Instead of only editing after the design is finished, creators can discuss ideas with AI agents and apply structured map changes as the setting takes shape.

## Core Features

- Edit hex-based maps in a visual WebUI
- Layer terrain and biome data on each cell
- Draw river overlays across cells from the WebUI or CLI, with width anchors and water endpoint hints
- Store maps in local SQLite storage, with structured JSON import/export for archives and interchange
- Search visual materials, sample terrain, paint strokes, and edit river nodes and widths directly
- Read shared terrain symbols, ecology textures, whole-map legends, and continuous water surfaces
- Preview and export PNG maps with titles, legends, transparent backgrounds, and grid-distance references
- Stream large JSON files into SQLite and export tiled PNG packages with a position manifest and browsable index
- Merge maps with placement previews, overlap rules, river copying, and persistent undo/redo
- Inspect and modify maps through a structured CLI for scripts and AI agents
- Use summary and range-based queries for larger maps instead of loading every cell
- Use the same map rules across WebUI, CLI, and exports

## Screenshot

![MapDesigner main interface](./docs/research/2026-10-03/visual-redesign/workspace-final.png)

See the [browser acceptance record](./docs/research/2026-10-03/visual-redesign/README.md) for responsive layouts and verified editing workflows.

## Quick Start

### Run from source

```bash
pnpm install --frozen-lockfile
pnpm build
pnpm start
```

Then open `http://localhost:3010`.

### Run with Docker

```bash
docker build -t mapdesigner:0.3.0-rc.2 .
docker run --rm -p 127.0.0.1:3010:3010 -e MAPDESIGNER_TOKEN=replace-with-a-long-random-token -v mapdesigner-data:/data mapdesigner:0.3.0-rc.2
```

Then open `http://localhost:3010`.

For detailed setup steps, see the [Deployment Guide](./docs/deployment.md) and [Docker Guide](./docs/docker.md).
Enter the container's access token in the map menu connection settings.
For an existing installation, follow the [upgrade steps](./docs/deployment.md#升级到-v030-rc2) before starting this version with your data.

## AI Agent / CLI

MapDesigner ships with a structured CLI so scripts and AI agents can inspect maps, apply deterministic edits, and export results without touching the WebUI.

```bash
pnpm exec tsx apps/server/src/cli.ts maps summary --map-id my-map
pnpm exec tsx apps/server/src/cli.ts maps cells --map-id my-map --min-row -10 --max-row 10 --min-col -10 --max-col 10
```

More examples and command conventions are documented in [Agent CLI Guide](./docs/agent-cli.md).

## Documentation

- [Documentation Index](./docs/index.md)
- [User Manual](./docs/user-manual.md)
- [Deployment Guide](./docs/deployment.md)
- [Docker Guide](./docs/docker.md)
- [Agent CLI Guide](./docs/agent-cli.md)
- [Development Guide](./docs/development.md)
- [Architecture and Repository Layout](./docs/architecture.md)
- [Validation Records and Pending Checks](./docs/research/README.md)
- [Changelog](./CHANGELOG.md)
- [Historical Documents](./docs/archive/README.md)
- [中文说明](./README.zh-CN.md)

## Current Release

`v0.3.0-rc.2` adds streamed large-file import, faster overviews, tiled image packages, and map merging with persistent undo/redo. It includes the redesigned workspace, visual materials, direct river editing, and shared cartographic output from RC1. See the [changelog](./CHANGELOG.md), [user manual](./docs/user-manual.md), and [capacity/workflow record](./docs/research/large-map-capacity/README.md).

## Development Note

Use the Node.js version in `.nvmrc` and the pnpm version in `package.json`.
After `pnpm install --frozen-lockfile`, run `pnpm check` to build, typecheck, and test,
or `pnpm dev` to start the API and WebUI together.
See the [Development Guide](./docs/development.md) for setup and validation, and the [maintenance scripts](./scripts/README.md) for backups and benchmarks.

AI assistance was used during the development of this project.

## License

This project is licensed under the [GNU General Public License v3.0](./LICENSE).
