import { describe, expect, it } from "vitest";
import { applyCommand, createEmptyDocument, createRuntimeState } from "@mapdesigner/map-core";
import { buildHexLayout } from "./layout.js";
import { buildExportScene, buildMapScene, renderSvgString } from "./scene.js";
import type { ActiveCell } from "@mapdesigner/map-core";

function makeCell(row: number, col: number): ActiveCell {
  return {
    id: `cell@${row},${col}`,
    display_coord: `R${row}C${col}`,
    row,
    col,
    status: "undesigned",
    terrain: null,
    biome: null,
    tags: [],
    note: ""
  };
}

describe("buildHexLayout", () => {
  it("places positive rows upward and positive columns to the right", () => {
    const result = buildHexLayout(
      [makeCell(0, 0), makeCell(1, 1), makeCell(-1, 1)],
      { size: 36, padding: 48 }
    );

    const origin = result.layout.find((entry) => entry.cell.row === 0 && entry.cell.col === 0);
    const upperRight = result.layout.find((entry) => entry.cell.row === 1 && entry.cell.col === 1);
    const lowerRight = result.layout.find((entry) => entry.cell.row === -1 && entry.cell.col === 1);

    expect(origin).toBeTruthy();
    expect(upperRight).toBeTruthy();
    expect(lowerRight).toBeTruthy();
    expect(upperRight!.centerX).toBeGreaterThan(origin!.centerX);
    expect(upperRight!.centerY).toBeLessThan(origin!.centerY);
    expect(lowerRight!.centerX).toBeGreaterThan(origin!.centerX);
    expect(lowerRight!.centerY).toBeGreaterThan(origin!.centerY);
  });

  it("keeps cell positions stable when rendering a subset with fixed bounds", () => {
    const boundsCoords = [
      { row: -5, col: -5 },
      { row: -5, col: 5 },
      { row: 5, col: -5 },
      { row: 5, col: 5 }
    ];
    const full = buildHexLayout(
      [makeCell(0, 0), makeCell(2, 2)],
      { size: 36, padding: 48, boundsCoords }
    );
    const subset = buildHexLayout(
      [makeCell(2, 2)],
      { size: 36, padding: 48, boundsCoords }
    );
    const fullCell = full.layout.find((entry) => entry.cell.row === 2 && entry.cell.col === 2);
    const subsetCell = subset.layout.find((entry) => entry.cell.row === 2 && entry.cell.col === 2);

    expect(subset.width).toBe(full.width);
    expect(subset.height).toBe(full.height);
    expect(subset.minX).toBe(full.minX);
    expect(subset.minY).toBe(full.minY);
    expect(subsetCell?.centerX).toBe(fullCell?.centerX);
    expect(subsetCell?.centerY).toBe(fullCell?.centerY);
  });
});

describe("river rendering", () => {
  it("renders river overlay bodies and includes river coordinates in scene bounds", () => {
    const runtime = createRuntimeState(createEmptyDocument({ id: "river-render", name: "River Render" }));
    const result = applyCommand(runtime, {
      action: "create_river",
      source: "cli",
      river: {
        id: "main-river",
        name: "Main River",
        points: [
          { row: 0, col: 0, width: 2 },
          { row: 0, col: 3, width: 8 }
        ]
      }
    });

    expect(result.ok).toBe(true);
    const scene = buildMapScene(result.map);
    expect(scene.riverBodies).toHaveLength(1);
    expect(scene.riverBodies[0]?.bodyPath).toContain("M ");
    expect(scene.riverBodies[0]?.widthRange.max).toBeGreaterThan(scene.riverBodies[0]?.widthRange.min ?? 0);
    expect(scene.riverBodies[0]?.pointCount).toBeGreaterThan(3);
    const svg = renderSvgString(scene);
    expect(svg).toContain('data-river-id="main-river"');
    expect(svg).toContain('fill="#2F83B7"');
  });

  it("reduces river body density in low-detail render mode", () => {
    const runtime = createRuntimeState(createEmptyDocument({ id: "river-lod", name: "River LOD" }));
    const result = applyCommand(runtime, {
      action: "create_river",
      source: "cli",
      river: {
        id: "long-river",
        name: "Long River",
        points: [
          { row: 0, col: 0, width: 4 },
          { row: 0, col: 8, width: 4 }
        ]
      }
    });

    expect(result.ok).toBe(true);
    const highDetail = buildMapScene(result.map, { riverDetail: "high" });
    const lowDetail = buildMapScene(result.map, { riverDetail: "low" });
    expect(highDetail.riverBodies).toHaveLength(1);
    expect(lowDetail.riverBodies).toHaveLength(1);
    expect(highDetail.riverBodies[0]?.pointCount).toBeGreaterThan(lowDetail.riverBodies[0]?.pointCount ?? 0);
  });

  it("renders water endpoint connections and preview river bodies", () => {
    const runtime = createRuntimeState(createEmptyDocument({ id: "river-preview", name: "River Preview" }));
    const withLake = applyCommand(runtime, {
      action: "set_cell",
      source: "cli",
      target: { row: 0, col: 2 },
      changes: { terrain: "lake" }
    });
    expect(withLake.ok).toBe(true);

    const scene = buildMapScene(withLake.map, {
      previewRivers: [
        {
          id: "__river-preview",
          name: "Preview",
          points: [
            { row: 0, col: 0, width: 2 },
            { row: 0, col: 2, width: 6 }
          ],
          color: "#3A8EC1",
          opacity: 0.82
        }
      ]
    });
    const svg = renderSvgString(scene);

    expect(scene.riverBodies).toHaveLength(1);
    expect(scene.riverBodies.every((body) => body.preview)).toBe(true);
    expect(scene.riverBodies[0]?.connectedEnd).toBe(true);
    expect(scene.riverControlPoints.map((point) => point.position)).toEqual(["start", "end"]);
    expect(svg).toContain('data-river-preview="true"');
    expect(svg).toContain('data-river-connected-end="true"');
    expect(svg).toContain('data-river-control-point="start"');
  });
});

describe("export rendering", () => {
  it("uses lightweight fills for png export while preserving river overlays", () => {
    let runtime = createRuntimeState(createEmptyDocument({ id: "export-render", name: "Export Render" }));
    const cellResult = applyCommand(runtime, {
      action: "set_cell",
      source: "cli",
      target: { row: 0, col: 0 },
      changes: {
        terrain: "plain",
        biome: "grassland"
      }
    });
    expect(cellResult.ok).toBe(true);
    runtime = cellResult.map;

    const riverResult = applyCommand(runtime, {
      action: "create_river",
      source: "cli",
      river: {
        id: "export-river",
        name: "Export River",
        points: [
          { row: 0, col: 0, width: 2 },
          { row: 0, col: 1, width: 4 }
        ]
      }
    });
    expect(riverResult.ok).toBe(true);

    const interactiveSvg = renderSvgString(buildMapScene(riverResult.map));
    expect(interactiveSvg).toContain("url(#pattern-grass)");

    const exportSvg = renderSvgString(
      buildExportScene({
        map: riverResult.map,
        options: {
          preset: "reference",
          includeCoordinates: true,
          includeShorthand: true,
          includeGrid: true,
          includeUndesigned: false,
          background: "#FFFFFF",
          padding: 24,
          scale: 1
        }
      })
    );
    expect(exportSvg).not.toContain("url(#pattern-grass)");
    expect(exportSvg).toContain('data-river-id="export-river"');
  });

  it("omits the background rectangle for transparent export", () => {
    const runtime = createRuntimeState(createEmptyDocument({ id: "transparent-export", name: "Transparent Export" }));
    const svg = renderSvgString(
      buildExportScene({
        map: runtime,
        options: {
          preset: "clean",
          includeCoordinates: false,
          includeShorthand: false,
          includeGrid: true,
          includeUndesigned: false,
          background: "transparent",
          padding: 24,
          scale: 1
        }
      })
    );

    expect(svg).not.toContain('width="100%" height="100%" fill="transparent"');
  });
});
