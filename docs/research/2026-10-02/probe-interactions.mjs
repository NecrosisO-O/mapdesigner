// Controlled interaction probes; in-memory DOM and API callbacks only.
import { createRequire } from 'node:module';
const root = new URL('../../../', import.meta.url);
const requireWeb = createRequire(new URL('apps/web/package.json', root));
const { JSDOM } = requireWeb('jsdom');
const dom = new JSDOM('<!doctype html><html><body></body></html>', { url: 'http://localhost' });
globalThis.window = dom.window;
globalThis.document = dom.window.document;
globalThis.HTMLElement = dom.window.HTMLElement;
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
const { act, renderHook, cleanup } = requireWeb('@testing-library/react');
const { createEmptyDocument, createRuntimeState } = await import(new URL('packages/map-core/dist/index.js', root));
const { useCellEditor } = await import(new URL('apps/web/src/useCellEditor.ts', root));
const { useAdvancedEditor } = await import(new URL('apps/web/src/useAdvancedEditor.ts', root));
const { useRiverEditor } = await import(new URL('apps/web/src/useRiverEditor.ts', root));
const results = {};
const makeMap = (id = 'A') => {
  const document = createEmptyDocument({ id, name: id });
  document.cells = [{ row: 0, col: 0, terrain: 'plain', biome: 'grassland', tags: ['peak'], note: 'Keep this note' }];
  return createRuntimeState(document);
};
const cellOf = map => map.activeCells.find(cell => cell.status === 'designed');
async function probe(name, run) {
  try { results[name] = await run(); } catch (error) { results[name] = { probeError: String(error) }; }
  finally { cleanup(); }
}
try {
  await probe('cell_draft_lost_when_outside_viewport', async () => {
    const map = makeMap();
    const { result, rerender } = renderHook(({ map }) => useCellEditor(map, async () => null, () => {}), { initialProps: { map } });
    await act(async () => result.current.handleCanvasCellSelect(cellOf(map)));
    await act(async () => result.current.setDraft(draft => ({ ...draft, note: 'Unsaved user note' })));
    const before = { selected: result.current.selectedCellId, note: result.current.draft.note, dirty: result.current.cellDirty };
    await act(async () => rerender({ map: { ...map, activeCells: [] } }));
    return { before, after: { selected: result.current.selectedCellId, note: result.current.draft.note, dirty: result.current.cellDirty } };
  });
  await probe('batch_selection_lost_when_outside_viewport', async () => {
    const map = makeMap();
    const { result, rerender } = renderHook(({ map }) => useAdvancedEditor(map, async () => null, () => {}), { initialProps: { map } });
    await act(async () => result.current.toggleBatchCell(cellOf(map)));
    const before = result.current.batchSelectedCellIds.size;
    await act(async () => rerender({ map: { ...map, activeCells: [] } }));
    return { before, after: result.current.batchSelectedCellIds.size };
  });
  await probe('river_draft_crosses_map_switch', async () => {
    const map = makeMap();
    const calls = [];
    const { result, rerender } = renderHook(({ map }) => useRiverEditor(map, async commands => { calls.push({ mapId: map.document.meta.id, commands }); return null; }, () => {}), { initialProps: { map } });
    await act(async () => result.current.startRiverDrawing());
    await act(async () => result.current.appendRiverPoint(cellOf(map)));
    await act(async () => result.current.appendRiverPoint({ ...cellOf(map), id: 'cell@0,1', display_coord: 'R0C1', col: 1 }));
    await act(async () => rerender({ map: makeMap('B') }));
    const afterSwitch = { status: result.current.riverDrawingStatus, points: result.current.riverDrawingPoints.length };
    await act(async () => result.current.finishRiverDrawing());
    return { draftStartedOn: 'A', afterSwitch, submittedMap: calls[0]?.mapId };
  });
  await probe('double_apply_sends_two_mutations', async () => {
    const map = makeMap();
    let calls = 0;
    let resolve;
    const pending = new Promise(r => { resolve = r; });
    const { result } = renderHook(() => useCellEditor(map, () => { calls++; return pending; }, () => {}));
    await act(async () => result.current.handleCanvasCellSelect(cellOf(map)));
    let first, second;
    await act(async () => { first = result.current.applyDraft(); second = result.current.applyDraft(); });
    const beforeResponse = calls;
    await act(async () => { resolve(null); await Promise.all([first, second]); });
    return { clicks: 2, mutationsBeforeAnyResponse: beforeResponse };
  });
  await probe('batch_terrain_also_clears_other_fields', async () => {
    const map = makeMap();
    const calls = [];
    const { result } = renderHook(() => useAdvancedEditor(map, async commands => { calls.push(commands); return null; }, () => {}));
    await act(async () => result.current.toggleBatchCell(cellOf(map)));
    await act(async () => result.current.setBatchTerrain('hill'));
    await act(async () => result.current.applyBatchEdit());
    return { before: map.document.cells[0], changedControl: 'terrain', submittedChanges: calls[0]?.[0]?.changes };
  });
} finally { dom.window.close(); }
console.log(JSON.stringify(results, null, 2));
