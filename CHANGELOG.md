# Changelog

All notable changes to this project will be documented in this file.

## [0.3.0] - 2026-10-05

Stable release combining the changes in 0.3.0-rc.1 and 0.3.0-rc.2. This entry summarizes changes since 0.2.0.

### Added

- A redesigned workspace with contextual inspectors, searchable visual materials, sampling, stroke painting, whole-map object search, layer controls, and light/dark themes.
- Shared terrain symbols, ecology textures, graphical markers, legends, and continuous water surfaces across the editor and exports.
- Direct river node and width editing, explicit junctions, flow direction, water endpoint settings, and branches.
- SQLite map storage with persistent undo/redo, atomic edits, revision checks, legacy JSON import, and an online backup command.
- Background import and export with progress, cancellation, and streamed JSON file import up to 2 GiB and 25 million cells, subject to the documented resource budgets.
- PNG previews and exports with titles, legends, transparent backgrounds, direction, and grid-distance references; tiled PNG packages include a position manifest and browsable index.
- Hex map merging with placement and overlap previews, keep-target or replace-target rules, river copying, and persistent undo/redo for the entire merge.

### Changed

- Summary and range queries, persistent terrain aggregates, paginated feature search, and bounded viewport rendering keep large maps usable during browsing and local editing.
- New rivers interpolate width by path distance; existing maps and history retain their width rules until compatible editing conversion.
- Network listening requires an access token, with host/origin validation and temporary download credentials. Production containers run as UID 1000 and include CJK fonts.
- Current documentation is consolidated into user, deployment, CLI, development, and architecture guides. Historical personal environment records have been removed.

### Fixed

- Partial command/history writes, conflicting edits, and unnecessary full-map processing during local edits.
- River width changes from unanchored nodes, false connections at viewport cuts, wide-bend holes, confluence overpainting, and internal river bands across lakes.
- Narrow-screen inspector overlap, inaccessible landscape export actions, inconsistent canvas/export textures and fonts, and incomplete river search results.
- Dense SVG output while zooming, overview counts at clipped boundaries, large textured export tile timeouts, and completed job results expiring immediately after long exports.

### Upgrade

- Stop the server and CLI processes and back up the entire data directory or Docker volume. Reuse the existing data root when starting 0.3.0; RC1/RC2 SQLite maps and history are retained, and missing tables are initialized automatically.
- Use Node.js 24.16.0 and pnpm 10.23.0, then run `pnpm install --frozen-lockfile` and `pnpm build`. Docker users rebuild the 0.3.0 image and reuse their data volume and access token.
- Import large legacy JSON files through the WebUI file importer or CLI `maps import --file ./map.json --summary`. See the [upgrade guide](./docs/deployment.md#升级到-v030), [Docker instructions](./docs/deployment.md#升级已有数据卷), and [backup guide](./docs/deployment.md#备份与恢复).

### Validation

- 235 regression tests cover core, rendering, storage, background jobs, CLI, and editor workflows; builds, types, formatting, and production container checks pass.
- Maintainer hands-on acceptance covers the redesigned editor and river/export workflows. Desktop and narrow-screen checks include merging, dark-theme tiled exports, real ZIP downloads, and million-cell import and local editing.
- Synthetic capacity measurements cover 110,000 through 23 million cells, with a million-cell merge/history/JSON round trip and regional tiled output. See the [validation record](./docs/research/README.md) and [capacity record](./docs/research/large-map-capacity/README.md).

## [0.3.0-rc.2] - 2026-10-04

Second release candidate for 0.3.0. This entry covers changes since 0.3.0-rc.1; all RC1 features are included.

### Added

- Streamed JSON file import with per-record validation, temporary SQLite staging, atomic publication, cancellation, and interrupted-task cleanup. Web uploads and CLI `maps import --summary` accept up to 2 GiB and 25 million cells.
- Tiled PNG export for a whole map or selected region, with a consistent revision and pixel frame, bounded rendering, ZIP download, position manifest, and a browsable index with legends.
- Hex map merging with translation, overlap previews, keep-target or replace-target rules, river/junction remapping, revision checks, and persistent undo/redo for the entire merge.
- Reproducible synthetic capacity measurements through 23 million cells, a million-cell merge/history/JSON round trip, and desktop/narrow-screen workflow evidence.

### Changed

- Persistent terrain bins and material counts keep large-map overviews and legends quick after edits and history operations.
- Large textured export tiles are rendered in smaller internal surfaces before composition; sample previews favor populated map areas.
- Import, merge/history, and JSON jobs have a 15-minute budget; tiled exports have one hour.

### Fixed

- Retain completed job results for 15 minutes after completion so long exports remain available to download.
- Keep overview tile counts within the response budget when range boundaries cut through cached bins.
- Use overviews above 8000 cells per requested viewport to avoid large SVG bursts while zooming into dense maps.

### Project scope

- Historical PR #3 was reviewed and closed with attribution. Its applicable requests are handled in #7, #8, and #9 on the current architecture. Square grids are outside the supported model; forks may add them. Original large-map feedback files are still requested in #2.

### Upgrade

- Stop the server and CLI processes, back up the data directory or Docker volume, and keep the existing data root when starting RC2. Existing SQLite maps and history are retained; the additional aggregate and merge-history tables are initialized automatically.
- Use Node.js 24.16.0 and pnpm 10.23.0, then run `pnpm install --frozen-lockfile` and `pnpm build`. Docker users rebuild the RC2 image and reuse their data volume and access token.
- Import large legacy JSON files through the WebUI file importer or CLI `maps import --file ./map.json --summary`. The legacy directory scan retains its existing file-size budget. See the [upgrade guide](./docs/deployment.md#升级到-v030-rc2) and [Docker instructions](./docs/deployment.md#升级已有数据卷).

### Validation

- 235 regression tests cover core, rendering, storage, background jobs, CLI, and editor workflows; builds, types, formatting, and production container checks pass.
- Synthetic capacity measurements cover 110,000 through 23 million cells; a million-cell workflow covers merging, persistent undo/redo, JSON round trips, and regional tiled output.
- Browser acceptance covers desktop/narrow-screen merging, dark-theme tiled exports and real ZIP downloads, plus million-cell import, zoom, local editing, and undo. Measurements, scope, and screenshots are in the [capacity record](./docs/research/large-map-capacity/README.md).

## [0.3.0-rc.1] - 2026-10-03

First release candidate for 0.3.0. This entry covers all changes since 0.2.0.

### Added

- SQLite map storage with persistent undo/redo history, legacy JSON import, and an online backup command.
- Summary and range queries, paginated feature search, streamed JSON export, and map overviews for larger maps.
- A canvas-focused workspace with contextual inspectors, visual materials, sampling, stroke painting, whole-map object search, layer controls, and shared legends.
- Natural and classic map styles with terrain symbols, ecology textures, graphical markers, and explicit compatibility for existing maps.
- Direct river node and width editing, explicit junctions, flow and endpoint settings, branches, and local editing advice.
- Background import and export jobs with progress, cancellation, revision checks, and resource budgets.
- Actual PNG previews and composed exports with titles, captions, legends, transparent backgrounds, direction, and grid-distance references.
- Fourteen reproducible cartographic fixtures, browser comparisons, color-vision simulations, and separate rendering/data performance records.

### Changed

- Map commands and history updates run atomically, and editor mutations are serialized with revision checks.
- Editor drafts, material painting, river editing, and export tasks have dedicated state and cancellation handling.
- New rivers interpolate width by path distance; old maps and history retain their original width rules until compatible editing conversion.
- Network listening requires an access token, with host/origin checks and temporary download credentials.
- The runtime uses Node.js 24.16.0 and pnpm 10.23.0. Production containers run as UID 1000 and include CJK fonts.
- CI verifies builds, types, tests, formatting, and production container startup and export.

### Fixed

- Partial command/history writes, conflicting edits, and unnecessary full-map work during local edits.
- River width changes caused by inserting unanchored nodes, false connections at viewport cuts, wide-bend holes, confluence overpainting, and internal river bands across lakes.
- Narrow-screen inspector overlap and landscape export previews covering action buttons.
- Inconsistent canvas/export textures and label fonts, missing CJK fonts in containers, and inaccessible rivers beyond the first result page.

### Upgrade

- Stop the old server and CLI processes, and back up the entire data directory or Docker volume before upgrading.
- Keep the existing data root. Legacy files in `storage/maps` are imported into SQLite and retained; maps and new history are saved in `storage/mapdesigner.db`.
- Use Node.js 24.16.0 and pnpm 10.23.0 for source deployments. Set `MAPDESIGNER_TOKEN` for Docker or network listening and enter it in the map menu connection settings.
- Ensure the existing Docker data volume is writable by UID/GID 1000. See the [upgrade guide](./docs/deployment.md#升级到-v030-rc1) and [Docker instructions](./docs/deployment.md#升级已有数据卷) for the steps.

### Validation

- 214 regression tests cover core rules, rendering, server and CLI behavior, and editor workflows.
- Production container checks cover non-root execution, access tokens, CJK fonts, background previews, and PNG downloads.
- Maintainer hands-on acceptance completed for RC1. Measured results and implementation evidence are recorded in the [acceptance record](./docs/research/README.md#视觉与交互).

## [0.2.0] - 2026-05-25

### Added

- Reworked WebUI layout with clearer map, view, export, editor, and history panels.
- Added pointer-centered zooming, drag panning, deep zoom support, and drag-click suppression for the map canvas.
- Added viewport-aware coordinate label rendering with sparse, medium, and full detail modes to keep large maps responsive.
- Added structured PNG export options to the CLI, including scale, padding, background, and visibility toggles.

### Changed

- Hardened server API request validation and error envelopes for malformed bodies, invalid commands, and export options.
- Moved map and export path handling into safer storage helpers with map id validation and atomic writes.
- Limited oversized area inspection requests for more predictable CLI and API behavior.
- Updated app tests to interact with map cells through accessible cell buttons instead of assuming coordinate text is always rendered.

### Fixed

- Prevented path traversal through map ids and exported PNG file names.
- Avoided leaking low-level filesystem paths in common API error responses.
- Reduced zoom jitter caused by rendering thousands of coordinate labels at once.

## [0.1.0] - 2026-03-26

First public release.

### Added

- Local-first WebUI for hex-based map editing
- Structured CLI for inspection, deterministic edits, and export workflows
- Shared core map rules across WebUI, CLI, and exports
- JSON map persistence and PNG export
- Deployment guides for source and Docker usage

### Included In This Release

- Hex grid map rendering with coordinate display
- Terrain and biome layered editing
- Map save, reopen, duplicate, rename, import, and export workflows
- Agent-oriented inspection commands such as `inspect-cell`, `inspect-area`, and neighbor queries
- Docker image build and browser-based access through the mapped server port
