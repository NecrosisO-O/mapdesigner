# Changelog

All notable changes to this project will be documented in this file.

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
