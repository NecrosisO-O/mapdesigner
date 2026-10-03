# Changelog

All notable changes to this project will be documented in this file.

## Unreleased

### Added

- A canvas-focused workspace with contextual inspectors, visual materials, sampling, stroke painting, whole-map object search, layer controls, and shared legends.
- Natural and classic map styles with terrain symbols, ecology textures, graphical markers, and explicit compatibility for existing maps.
- Direct river node and width editing, explicit junctions, flow and endpoint settings, branches, and local editing advice.
- Actual PNG previews, revision checks, composition with titles and legends, transparent output, and bounded background tasks.
- Fourteen reproducible cartographic fixtures, browser comparisons, color-vision simulations, and separate rendering/data performance records.

### Fixed

- River width changes caused by inserting unanchored nodes, false connections at viewport cuts, wide-bend holes, confluence overpainting, and internal river bands across lakes.
- Narrow-screen inspector overlap and landscape export previews covering action buttons.
- Inconsistent canvas/export textures and label fonts, missing CJK fonts in containers, and inaccessible rivers beyond the first result page.

### Validation

- See the [visual acceptance record](./docs/research/2026-10-03/visual-redesign/README.md) for measured results and outstanding real-device, screen-reader, page-zoom, and first-time-user studies.

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
