// Run with: node --import ./apps/server/node_modules/tsx/dist/loader.mjs <this file>
// Uses an in-memory DOM and controlled API replies; no browser or server data is changed.
import { createRequire } from "node:module";
const root = new URL("../../../", import.meta.url);
const requireWeb = createRequire(new URL("apps/web/package.json", root));
const { JSDOM } = requireWeb("jsdom");
const dom = new JSDOM("<!doctype html><html><body></body></html>", { url: "http://localhost" });
globalThis.window = dom.window;
globalThis.document = dom.window.document;
globalThis.HTMLElement = dom.window.HTMLElement;
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
const { act, renderHook, cleanup } = requireWeb("@testing-library/react");
const { useMapWorkspace } = await import(new URL("apps/web/src/useMapWorkspace.ts", root));
const { api } = await import(new URL("apps/web/src/api.ts", root));
const results = {};
const ok = result => ({ ok: true, result, warnings: [], errors: [] });
const summary = id => ({ meta: { id, name: id, description: "", tags: [], revision: 1, created_at: "2026-10-02T00:00:00.000Z", updated_at: "2026-10-02T00:00:00.000Z" }, grid: { layout: "flat-top-even-q", origin: { row: 0, col: 0 } }, bounds: { min_row: 0, max_row: 0, min_col: 0, max_col: 0 }, designed_cell_count: 1, feature_counts: { rivers: 0 } });
const cell = { id: "cell@0,0", display_coord: "R0C0", row: 0, col: 0, status: "designed", terrain: "plain", biome: null, tags: [], note: "" };
const deferred = () => { let resolve; const promise = new Promise(r => { resolve = r; }); return { promise, resolve }; };
function resetApi() {
  api.listMaps = async () => ok([]);
  api.getMapSummary = async id => ok(summary(id));
  api.getCellsInRange = async (id, range) => ok({ map_id: id, revision: 1, range, cells: [cell] });
  api.getMapFeaturesInRange = async () => ok({ rivers: [], page: { total: 0, returned: 0, has_more: false, offset: 0, limit: 1000 } });
  api.getMapHistory = async () => ok({ entries: [], status: { canUndo: false, canRedo: false, cursor: 0, latest: 0 } });
}
async function probe(name, run) {
  resetApi();
  const messages = [];
  const hook = renderHook(() => useMapWorkspace(message => messages.push(message)));
  await act(async () => {});
  try { results[name] = await run(hook, messages); }
  catch (error) { results[name] = { probeError: String(error), stack: error.stack }; }
  finally { cleanup(); }
}

try {
  await probe("out_of_order_map_open", async ({ result }) => {
    const slow = deferred();
    api.getMapSummary = async id => id === "A" ? slow.promise : ok(summary(id));
    let openingA;
    await act(async () => { openingA = result.current.openMap("A"); });
    await act(async () => { await result.current.openMap("B"); });
    const afterB = result.current.currentMapId;
    await act(async () => { slow.resolve(ok(summary("A"))); await openingA; });
    return { lastRequested: "B", afterB, finalMap: result.current.currentMapId };
  });

  await probe("rename_lost_on_pan", async ({ result }) => {
    await act(async () => { await result.current.openMap("rename-map"); });
    await act(async () => { result.current.renameCurrentMap("User draft"); });
    const beforePan = { name: result.current.currentMap.document.meta.name, dirty: result.current.mapDirty };
    await act(async () => { await result.current.requestVisibleRange({ minRow: 100, maxRow: 110, minCol: 100, maxCol: 110 }); });
    return { beforePan, afterPan: { name: result.current.currentMap.document.meta.name, dirty: result.current.mapDirty } };
  });

  await probe("failed_range_cannot_retry", async ({ result }) => {
    await act(async () => { await result.current.openMap("retry-map"); });
    let requests = 0;
    api.getCellsInRange = async (id, range) => {
      requests += 1;
      return requests === 1 ? { ok: false, errors: [{ message: "temporary failure" }], warnings: [] } : ok({ map_id: id, revision: 1, range, cells: [cell] });
    };
    const range = { minRow: 100, maxRow: 110, minCol: 100, maxCol: 110 };
    await act(async () => { await result.current.requestVisibleRange(range); });
    await act(async () => { await result.current.requestVisibleRange(range); });
    return { attempts: 2, expectedNetworkRequests: 2, actualNetworkRequests: requests };
  });

  await probe("overview_range_is_truncated", async ({ result }) => {
    await act(async () => { await result.current.openMap("overview-map"); });
    let actual;
    api.getCellsInRange = async (id, range) => { actual = range; return ok({ map_id: id, revision: 1, range, cells: [cell] }); };
    const visible = { minRow: 0, maxRow: 999, minCol: 0, maxCol: 999 };
    await act(async () => { await result.current.requestVisibleRange(visible); });
    return { visible, actual, visibleArea: 1_000_000, requestedArea: (actual.maxRow - actual.minRow + 1) * (actual.maxCol - actual.minCol + 1) };
  });

  await probe("network_failure_keeps_loading", async ({ result }) => {
    api.getMapSummary = async () => { throw new TypeError("Failed to fetch"); };
    let error;
    await act(async () => { try { await result.current.openMap("offline-map"); } catch (e) { error = e.message; } });
    return { rejectedWith: error, loadingAfterFailure: result.current.loading };
  });

  await probe("import_framework_error_envelope", async ({ result }) => {
    api.importMap = async () => ({ statusCode: 413, code: "FST_ERR_CTP_BODY_TOO_LARGE", error: "Payload Too Large", message: "Request body is too large" });
    let error;
    await act(async () => {
      try { await result.current.importFile({ text: async () => "fixture" }); }
      catch (e) { error = { name: e.name, message: e.message }; }
    });
    return { frameworkStatus: 413, clientError: error };
  });
} finally { dom.window.close(); }
process.stdout.write(`${JSON.stringify(results, null, 2)}\n`);
