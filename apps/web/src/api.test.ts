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
