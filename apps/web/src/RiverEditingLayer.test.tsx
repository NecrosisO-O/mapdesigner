/* @vitest-environment jsdom */
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { RiverEditingLayer } from "./RiverEditingLayer.js";
import type { RiverFeature } from "@mapdesigner/map-core";
afterEach(cleanup);
const river: RiverFeature = {
  id: "test",
  name: "test",
  points: [
    { row: 0, col: 0, width: 4, junction_id: "shared" },
    { row: 0, col: 4, width: 10 }
  ]
};
function pointer(target: Element, type: string, x: number, y: number) {
  const event = new MouseEvent(type, { bubbles: true, clientX: x, clientY: y, button: 0 });
  Object.defineProperty(event, "pointerId", { value: 1 });
  fireEvent(target, event);
}
function setup(scale = 1) {
  const preview = vi.fn(),
    commit = vi.fn();
  render(
    <svg>
      <RiverEditingLayer
        river={river}
        selectedNode={0}
        scale={scale}
        minX={0}
        minY={0}
        disabled={false}
        toWorld={(x, y) => ({ x: x / scale, y: y / scale })}
        onSelectNode={vi.fn()}
        onPreview={preview}
        onCommit={commit}
      />
    </svg>
  );
  return { preview, commit, layer: screen.getByLabelText("河流节点编辑") };
}
it("previews a connected node move and commits once on release", () => {
  const { preview, commit, layer } = setup();
  const control = screen.getByRole("button", { name: "河流节点 1 已连接" });
  pointer(control, "pointerdown", 0, 0);
  pointer(layer, "pointermove", 54, -31.1769);
  pointer(layer, "pointermove", 108, -62.3538);
  expect(commit).not.toHaveBeenCalled();
  expect(preview.mock.calls.at(-1)?.[0].points[0]).toEqual({
    row: 0,
    col: 2,
    width: 4,
    junction_id: "shared"
  });
  pointer(layer, "pointerup", 108, -62.3538);
  expect(commit).toHaveBeenCalledTimes(1);
  expect(commit.mock.calls[0]?.[0][0].junction_id).toBe("shared");
});
it("drops cancelled gestures without writing", () => {
  const { commit, layer } = setup();
  pointer(screen.getByRole("button", { name: "河流节点 1 已连接" }), "pointerdown", 0, 0);
  pointer(layer, "pointermove", 54, -31);
  fireEvent.keyDown(layer, { key: "Escape" });
  pointer(layer, "pointerup", 54, -31);
  expect(commit).not.toHaveBeenCalled();
});
it.each([1, 2])("keeps width in map units at scale %s", (scale) => {
  const { commit, layer } = setup(scale);
  pointer(
    screen.getByRole("slider", { name: "节点 1 左侧宽度" }),
    "pointerdown",
    18 + 2 * scale,
    0
  );
  pointer(layer, "pointermove", 18 + 6 * scale, 0);
  pointer(layer, "pointerup", 18 + 6 * scale, 0);
  expect(commit.mock.calls[0]?.[0][0].width).toBe(12);
  expect(commit.mock.calls[0]?.[0][0].row).toBe(0);
});
