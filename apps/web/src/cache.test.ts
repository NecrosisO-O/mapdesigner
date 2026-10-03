import { expect, it } from "vitest";
import { ViewportCache } from "./editor-session.js";
import type { ActiveCell } from "@mapdesigner/map-core";
it("bounds display cache memory even when a single response exceeds its budget", () => {
  const cache = new ViewportCache(10, 2);
  const data = (count: number) => ({
    cells: Array.from({ length: count }, () => ({}) as ActiveCell),
    features: { rivers: [] }
  });
  cache.set("A", data(6));
  cache.set("B", data(6));
  expect(cache.get("A")).toBeUndefined();
  expect(cache.cellCount).toBe(6);
  cache.set("huge", data(20));
  expect(cache.get("huge")).toBeUndefined();
  expect(cache.cellCount).toBeLessThanOrEqual(10);
});
