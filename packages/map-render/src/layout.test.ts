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
});

describe("river rendering", () => {
  it("renders river overlay segments and includes river coordinates in scene bounds", () => {
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
    expect(scene.riverSegments).toHaveLength(3);
    expect(scene.riverSegments[0]?.width).toBeGreaterThan(2);
    const svg = renderSvgString(scene);
    expect(svg).toContain('data-river-id="main-river"');
    expect(svg).toContain('stroke="#2F83B7"');
  });

  it("renders water endpoint markers and preview river segments", () => {
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

    expect(scene.riverSegments).toHaveLength(2);
    expect(scene.riverSegments.every((segment) => segment.preview)).toBe(true);
    expect(scene.riverEndpoints).toHaveLength(1);
    expect(scene.riverControlPoints.map((point) => point.position)).toEqual(["start", "end"]);
    expect(svg).toContain('data-river-preview="true"');
    expect(svg).toContain('data-river-endpoint="water"');
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
