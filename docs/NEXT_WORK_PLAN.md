# MapDesigner Next Work Plan

## Purpose

This document records the agreed next-stage optimization plan after `0.1.0`.
The focus is not on changing the product direction, but on improving scalability,
maintainability, and large-map usability while preserving the current architecture.

## Strategy

1. Prioritize low-risk, high-return work first.
2. Keep each phase independently deliverable.
3. Avoid introducing new dependencies unless clearly necessary.
4. Preserve the current data model and command contract unless a task explicitly requires changes.

## Progress Snapshot

- Completed:
  - Phase 1.1 Dynamic History Limit
  - Phase 1.2 CLI Summary Output Mode
  - Phase 1.3 Compatibility Matrix Consistency Tests
  - Phase 2.4 Split `App.tsx`
  - Phase 3.5 Zoom-Level Rendering Degradation
  - Phase 3.6 Batch Statistics in Apply Results
- Pending:
  - Phase 4.7 Hybrid History Model Research

## Phase 1: Stable Scaling

### 1. Dynamic History Limit

Status: Completed

Files to modify:

- `packages/map-core/src/history.ts`
- `packages/map-core/src/serialization.ts`
- `packages/map-core/src/core.test.ts`

Files to create:

- None

Files that might be deleted:

- None

Description:

- Replace the fixed runtime history limit with a map-size-aware limit.
- Keep the current full-snapshot history model unchanged.
- Reduce retained undo steps automatically for larger maps to control memory growth.

Suggested policy:

- `0-300` designed cells: keep `100`
- `301-1000` designed cells: keep `60`
- `1001-3000` designed cells: keep `30`
- `3000+` designed cells: keep `15-20`

Risk:

- Large maps will retain fewer undo steps than small maps.
- This is an intentional tradeoff to reduce memory pressure without redesigning history.

Acceptance:

- Small maps behave almost exactly as they do now.
- Large maps automatically use a reduced history budget.
- Undo and redo behavior stays correct and predictable.

### 2. CLI Summary Output Mode

Status: Completed

Files to modify:

- `apps/server/src/cli.ts`
- `apps/server/src/service.ts`
- `apps/server/src/cli.test.ts`

Files to create:

- None

Files that might be deleted:

- None

Description:

- Add a lightweight output mode for `maps apply`, such as `--summary` or `--compact`.
- Preserve the current detailed JSON output as the default.
- Allow automation and AI workflows to request concise execution summaries for large batch updates.

Suggested summary fields:

- command count
- changed cell count
- created / updated / cleared counts
- warning count
- error count
- resulting revision
- terrain / biome summary

Risk:

- Low risk as long as the default output format remains unchanged.

Acceptance:

- Existing scripts continue to work without modification.
- Summary mode returns substantially shorter output while remaining useful for automated callers.

### 3. Compatibility Matrix Consistency Tests

Status: Completed

Files to modify:

- `packages/map-core/src/dictionaries.ts`
- `packages/map-core/src/validation.ts`
- `packages/map-core/src/core.test.ts`

Files to create:

- None

Files that might be deleted:

- None

Description:

- Keep the current dual-layer model:
  - UI filtering is guided by compatibility helpers.
  - command execution is protected by final validation rules.
- Add tests to ensure these two mechanisms do not drift over time.

Risk:

- Very low runtime risk.
- Test design must distinguish intentional warnings from truly invalid combinations.

Acceptance:

- Core terrain / biome combinations are covered by tests.
- Future dictionary expansions cannot silently create inconsistent UI and command behavior.

## Phase 2: Frontend Structure Cleanup

### 4. Split `App.tsx`

Status: Completed

Files to modify:

- `apps/web/src/App.tsx`
- `apps/web/src/App.test.tsx`

Files to create:

- `apps/web/src/useMapWorkspace.ts`
- `apps/web/src/useCellEditor.ts`
- `apps/web/src/useExportPanel.ts`
- `apps/web/src/SidebarPanel.tsx`
- `apps/web/src/DetailPanel.tsx`
- `apps/web/src/TopToolbar.tsx`

Files that might be deleted:

- None

Description:

- Do not introduce a state management library yet.
- Reduce the weight of `App.tsx` by extracting major logic groups into hooks and boundary components.
- Keep behavior unchanged while improving maintainability.

Suggested split:

- `useMapWorkspace`: map loading, saving, renaming, duplication, deletion
- `useCellEditor`: selection, draft editing, saving, clearing, format brush
- `useExportPanel`: export settings and API calls
- presentation components for toolbar and side panels

Risk:

- Medium risk because behavior stays the same while code moves around.
- Message handling, dirty-state prompts, and selection-change edge cases require careful regression testing.

Acceptance:

- Existing UI behavior remains unchanged.
- Tests still pass.
- `App.tsx` becomes substantially smaller and easier to reason about.

## Phase 3: Large Map Usability

### 5. Zoom-Level Rendering Degradation

Status: Completed

Files to modify:

- `apps/web/src/MapCanvas.tsx`
- `packages/map-render/src/*` relevant render entry files
- `apps/web/src/App.test.tsx`

Files to create:

- Optional, depending on implementation

Files that might be deleted:

- None

Description:

- Reduce rendered information density based on zoom level.
- Preserve the current SVG rendering path.
- Improve readability and rendering stability on larger maps by progressively hiding expensive or dense overlays.

Suggested levels:

- Near: show coordinates, shorthand, primary tags
- Mid: show coordinates, hide some shorthand/tag content
- Far: show terrain / biome visuals only
- Extreme far: reduce texture and label overlays further

Risk:

- Medium risk because visual changes can feel abrupt if thresholds are poorly tuned.

Acceptance:

- Large maps feel more stable during zoom and pan.
- Information transitions are understandable and not visually jarring.

### 6. Batch Statistics in Apply Results

Status: Completed

Files to modify:

- `apps/server/src/service.ts`
- `apps/server/src/cli.ts`
- `apps/server/src/api.ts`
- `apps/server/src/cli.test.ts`
- `apps/server/src/api.test.ts`

Files to create:

- None

Files that might be deleted:

- None

Description:

- Extend apply results with structured aggregate statistics.
- Help scripts and AI callers understand large batch edits without scanning all cell-level details.

Suggested fields:

- `changed_count`
- `created_count`
- `updated_count`
- `cleared_count`
- `terrain_summary`
- `biome_summary`

Risk:

- Low risk if added as new fields without changing existing semantics.

Acceptance:

- Callers can understand a large apply operation from summary fields alone when desired.

## Phase 4: Mid-Term Research

### 7. Hybrid History Model Research

Status: Pending

Files to modify:

- `packages/map-core/src/history.ts`
- `packages/map-core/src/types.ts`
- `packages/map-core/src/commands.ts`
- `packages/map-core/src/core.test.ts`

Files to create:

- Possibly a dedicated design note or research doc

Files that might be deleted:

- None

Description:

- Research, but do not immediately implement, a hybrid history model:
  - periodic full snapshots
  - diffs between checkpoints
- Use this only if Phase 1 proves insufficient for very large maps and long sessions.

Risk:

- High risk because it affects core runtime behavior and undo / redo correctness.

Acceptance:

- A clear technical design exists before any implementation starts.
- Implementation should begin only if real usage shows the current model has become a bottleneck.

## Not Recommended Right Now

- Do not introduce Redux or Zustand yet.
- Do not rewrite history into a pure diff model yet.
- Do not merge compatibility filtering and validation into one mechanism.
- Do not switch prematurely from SVG to Canvas or a map engine.

Reason:

- These changes are either higher-risk than their current value or would complicate the codebase before they are truly needed.

## Recommended Execution Order

1. Dynamic history limit
2. CLI summary output mode
3. Compatibility matrix consistency tests
4. Split `App.tsx`
5. Zoom-level rendering degradation
6. Batch statistics in apply results
7. Hybrid history model research

## Summary

The current `0.1.0` architecture is sound enough to continue building on.
The next phase should focus on:

- controlling runtime cost on larger maps
- keeping CLI workflows strong for automation and AI usage
- reducing frontend maintenance pressure before adding more features

This plan is intended as the working baseline for the next optimization cycle.
