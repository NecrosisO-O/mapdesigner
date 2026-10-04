// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { createEmptyDocument, type MapSummary, type MergeMapPreview } from "@mapdesigner/map-core";
import { api } from "./api.js";
import { MergeDialog } from "./MergeDialog.js";
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});
const summary = (id: string): MapSummary => ({
  meta: createEmptyDocument({ id, name: id }).meta,
  grid: { layout: "flat-top-even-q", origin: { row: 0, col: 0 } },
  bounds: { min_row: 0, max_row: 1, min_col: 0, max_col: 1 },
  designed_cell_count: 2,
  feature_counts: { rivers: 0 }
});
function setup() {
  const target = summary("target"),
    source = summary("source");
  vi.spyOn(api, "previewMerge").mockImplementation(async (_, input) => {
    const overview = {
      map_id: "source",
      revision: 1,
      range: { minRow: 0, maxRow: 1, minCol: 0, maxCol: 1 },
      bucket_size: 1,
      designed_cell_count: 2,
      tiles: [{ row: 0, col: 0, terrain: "plain" as const, count: 1, river: false }]
    };
    const result: MergeMapPreview = {
      input: { ...input, expectedSourceRevision: 3, expectedTargetRevision: 1 },
      target,
      source: { ...source, meta: { ...source.meta, revision: 3 } },
      added: 2,
      overlapping: 0,
      replaced: 0,
      rivers: 0,
      targetOverview: overview,
      sourceOverview: overview,
      conflicts: []
    };
    return { ok: true, result, warnings: [], errors: [] };
  });
  const complete = vi.fn().mockResolvedValue(undefined),
    close = vi.fn();
  render(
    <MergeDialog
      target={target}
      maps={[
        {
          id: "source",
          name: "来源岛",
          fileName: "source.json",
          updatedAt: "",
          revision: 3,
          designedCellCount: 2
        }
      ]}
      onComplete={complete}
      onClose={close}
    />
  );
  return { complete, close, target };
}
it("invalidates old placement previews and submits the confirmed versions", async () => {
  const { complete, target } = setup();
  vi.spyOn(api, "mergeMap").mockResolvedValue({
    ok: true,
    result: { summary: target, added: 2, replaced: 0, rivers: 0 },
    warnings: [],
    errors: []
  });
  await screen.findByRole("img", { name: "来源地图放置位置与重叠格概览" });
  fireEvent.change(screen.getByLabelText("行偏移"), { target: { value: "-4" } });
  expect((screen.getByRole("button", { name: "确认合并" }) as HTMLButtonElement).disabled).toBe(
    true
  );
  await waitFor(() =>
    expect((screen.getByRole("button", { name: "确认合并" }) as HTMLButtonElement).disabled).toBe(
      false
    )
  );
  fireEvent.click(screen.getByRole("button", { name: "确认合并" }));
  await waitFor(() => expect(complete).toHaveBeenCalled());
  expect(api.mergeMap).toHaveBeenCalledWith(
    "target",
    expect.objectContaining({
      offsetRow: -4,
      expectedSourceRevision: 3,
      expectedTargetRevision: 1
    }),
    expect.anything()
  );
});
it("keeps a commit conflict visible and requires another preview", async () => {
  setup();
  vi.spyOn(api, "mergeMap").mockResolvedValue({
    ok: false,
    warnings: [],
    errors: [
      { code: "revision_conflict", message: "来源地图已改变，请重新预览", severity: "invalid" }
    ]
  });
  await screen.findByRole("img", { name: "来源地图放置位置与重叠格概览" });
  fireEvent.click(screen.getByRole("button", { name: "确认合并" }));
  await screen.findByText("来源地图已改变，请重新预览");
  expect((screen.getByRole("button", { name: "确认合并" }) as HTMLButtonElement).disabled).toBe(
    true
  );
  fireEvent.click(screen.getByRole("button", { name: "重新预览" }));
  await waitFor(() =>
    expect((screen.getByRole("button", { name: "确认合并" }) as HTMLButtonElement).disabled).toBe(
      false
    )
  );
});
