import { afterEach, describe, expect, it, vi } from "vitest";
import { api } from "./api.js";

describe("web api client", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("does not send a JSON content type for bodyless POST requests", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue({
      json: async () => ({
        ok: true,
        result: {
          document: {},
          activeCells: [],
          history: { past: [], future: [], limit: 100 }
        },
        warnings: [],
        errors: []
      })
    } as Response);

    await api.duplicateMap("sample-map");

    expect(fetchMock).toHaveBeenCalledWith(
      "/api/maps/sample-map/duplicate",
      expect.objectContaining({
        method: "POST",
        headers: undefined
      })
    );
  });
});

it("normalizes framework errors and network failures", async () => {
  const fetchMock = vi.spyOn(globalThis, "fetch");
  fetchMock.mockResolvedValueOnce(new Response(JSON.stringify({ statusCode: 413, message: "Too large" }), { status: 413 }));
  const oversized = await api.listMaps();
  expect(oversized.ok).toBe(false);
  expect(oversized.errors[0]?.message).toBe("Too large");
  fetchMock.mockRejectedValueOnce(new TypeError("offline"));
  const offline = await api.listMaps();
  expect(offline.ok).toBe(false);
  expect(offline.errors[0]?.code).toBe("network_error");
  fetchMock.mockRestore();
});
