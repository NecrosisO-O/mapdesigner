import { describe, expect, it } from "vitest";
import { buildHexLayout } from "./layout.js";
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
