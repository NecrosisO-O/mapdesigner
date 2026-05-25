import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

async function loadApi(tempRoot: string) {
  process.env.MAPDESIGNER_ROOT = tempRoot;
  vi.resetModules();
  return import("./api.js");
}

describe("server api", () => {
  let tempRoot: string;

  beforeEach(async () => {
    tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), "mapdesigner-api-"));
  });

  afterEach(async () => {
    delete process.env.MAPDESIGNER_ROOT;
    await fs.rm(tempRoot, { recursive: true, force: true });
  });

  it("creates and fetches a map through http routes", async () => {
    const { createServer } = await loadApi(tempRoot);
    const app = await createServer();
    try {
      const created = await app.inject({
        method: "POST",
        url: "/api/maps",
        payload: { name: "API Test" }
      });
      expect(created.statusCode).toBe(200);
      const createdBody = created.json();
      expect(createdBody.ok).toBe(true);
      expect(createdBody.result.document.meta.name).toBe("API Test");

      const fetched = await app.inject({
        method: "GET",
        url: `/api/maps/${createdBody.result.document.meta.id}`
      });
      expect(fetched.statusCode).toBe(200);
      const fetchedBody = fetched.json();
      expect(fetchedBody.result.document.meta.id).toBe(createdBody.result.document.meta.id);

      const saveAs = await app.inject({
        method: "POST",
        url: `/api/maps/${createdBody.result.document.meta.id}/save-as`,
        payload: {
          document: createdBody.result.document,
          name: "API Test Copy"
        }
      });
      expect(saveAs.statusCode).toBe(200);
      const saveAsBody = saveAs.json();
      expect(saveAsBody.ok).toBe(true);
      expect(saveAsBody.result.document.meta.name).toBe("API Test Copy");
      expect(saveAsBody.result.document.meta.id).not.toBe(createdBody.result.document.meta.id);
    } finally {
      await app.close();
    }
  });

  it("returns structured errors for missing maps and id mismatches", async () => {
    const { createServer } = await loadApi(tempRoot);
    const app = await createServer();
    try {
      const missing = await app.inject({
        method: "GET",
        url: "/api/maps/not-found"
      });
      expect(missing.statusCode).toBe(404);
      const missingBody = missing.json();
      expect(missingBody.ok).toBe(false);
      expect(missingBody.errors[0].code).toBe("map_not_found");

      const created = await app.inject({
        method: "POST",
        url: "/api/maps",
        payload: { name: "Mismatch Test" }
      });
      const createdBody = created.json();

      const mismatch = await app.inject({
        method: "POST",
        url: `/api/maps/${createdBody.result.document.meta.id}/save-as`,
        payload: {
          document: {
            ...createdBody.result.document,
            meta: {
              ...createdBody.result.document.meta,
              id: "other-id"
            }
          },
          name: "Mismatch Copy"
        }
      });
      expect(mismatch.statusCode).toBe(400);
      const mismatchBody = mismatch.json();
      expect(mismatchBody.ok).toBe(false);
      expect(mismatchBody.errors[0].code).toBe("bad_request");
      expect(mismatchBody.errors[0].message).toMatch(/path id and document.meta.id/);
    } finally {
      await app.close();
    }
  });

  it("validates malformed create and save request bodies", async () => {
    const { createServer } = await loadApi(tempRoot);
    const app = await createServer();
    try {
      const missingName = await app.inject({
        method: "POST",
        url: "/api/maps",
        payload: {}
      });
      expect(missingName.statusCode).toBe(400);
      expect(missingName.json().errors[0].code).toBe("bad_request");

      const created = await app.inject({
        method: "POST",
        url: "/api/maps",
        payload: { name: "Save Body Test" }
      });
      const createdBody = created.json();
      const saveMissingRevision = await app.inject({
        method: "PUT",
        url: `/api/maps/${createdBody.result.document.meta.id}`,
        payload: {
          document: createdBody.result.document
        }
      });
      expect(saveMissingRevision.statusCode).toBe(400);
      expect(saveMissingRevision.json().errors[0].message).toMatch(/expectedRevision/);
    } finally {
      await app.close();
    }
  });

  it("exports a png and serves it through the download route", async () => {
    const { createServer } = await loadApi(tempRoot);
    const app = await createServer();
    try {
      const created = await app.inject({
        method: "POST",
        url: "/api/maps",
        payload: { name: "Download Test" }
      });
      const createdBody = created.json();
      const mapId = createdBody.result.document.meta.id as string;

      const exported = await app.inject({
        method: "POST",
        url: `/api/maps/${mapId}/export-png`,
        payload: { preset: "reference" }
      });
      expect(exported.statusCode).toBe(200);
      const exportedBody = exported.json();
      expect(exportedBody.ok).toBe(true);
      expect(exportedBody.result.fileName).toMatch(/download-test-reference\.png$/);
      expect(exportedBody.result.downloadUrl).toBe(`/api/exports/${encodeURIComponent(exportedBody.result.fileName)}`);

      const downloaded = await app.inject({
        method: "GET",
        url: exportedBody.result.downloadUrl
      });
      expect(downloaded.statusCode).toBe(200);
      expect(downloaded.headers["content-type"]).toContain("image/png");
      expect(downloaded.headers["content-disposition"]).toContain(exportedBody.result.fileName);
      expect(downloaded.body.length).toBeGreaterThan(0);
    } finally {
      await app.close();
    }
  });

  it("returns apply statistics from the api route", async () => {
    const { createServer } = await loadApi(tempRoot);
    const app = await createServer();
    try {
      const created = await app.inject({
        method: "POST",
        url: "/api/maps",
        payload: { name: "Apply API Test" }
      });
      const createdBody = created.json();
      const mapId = createdBody.result.document.meta.id as string;

      const applied = await app.inject({
        method: "POST",
        url: `/api/maps/${mapId}/apply`,
        payload: {
          commands: [
            {
              action: "set_cell",
              source: "cli",
              target: { row: 0, col: 0 },
              changes: {
                terrain: "plain",
                biome: "grassland"
              }
            }
          ]
        }
      });
      expect(applied.statusCode).toBe(200);
      const appliedBody = applied.json();
      expect(appliedBody.ok).toBe(true);
      expect(appliedBody.result.map.document.cells).toHaveLength(1);
      expect(appliedBody.result.stats.command_count).toBe(1);
      expect(appliedBody.result.stats.created_count).toBe(1);
      expect(appliedBody.result.stats.terrain_summary.after.plain).toBe(1);
    } finally {
      await app.close();
    }
  });

  it("rejects invalid apply and export payloads with structured errors", async () => {
    const { createServer } = await loadApi(tempRoot);
    const app = await createServer();
    try {
      const created = await app.inject({
        method: "POST",
        url: "/api/maps",
        payload: { name: "Invalid Payload Test" }
      });
      const createdBody = created.json();
      const mapId = createdBody.result.document.meta.id as string;

      const commandsNotArray = await app.inject({
        method: "POST",
        url: `/api/maps/${mapId}/apply`,
        payload: { commands: { action: "set_cell" } }
      });
      expect(commandsNotArray.statusCode).toBe(400);
      expect(commandsNotArray.json().errors[0].message).toMatch(/commands must be an array/);

      const invalidCommand = await app.inject({
        method: "POST",
        url: `/api/maps/${mapId}/apply`,
        payload: {
          commands: [
            {
              action: "set_cell",
              source: "cli",
              target: { row: 0, col: 0 },
              changes: {
                terrain: "missing-terrain",
                biome: "grassland"
              }
            }
          ]
        }
      });
      expect(invalidCommand.statusCode).toBe(400);
      const invalidCommandBody = invalidCommand.json();
      expect(invalidCommandBody.errors[0].code).toBe("bad_request");
      expect(invalidCommandBody.errors[0].issues[0].code).toBe("invalid_terrain");

      const invalidExport = await app.inject({
        method: "POST",
        url: `/api/maps/${mapId}/export-png`,
        payload: { preset: "poster", scale: 5 }
      });
      expect(invalidExport.statusCode).toBe(400);
      expect(invalidExport.json().errors[0].message).toMatch(/preset must be clean or reference/);
    } finally {
      await app.close();
    }
  });

  it("rejects path traversal ids and export file names without leaking filesystem paths", async () => {
    const { createServer } = await loadApi(tempRoot);
    const app = await createServer();
    try {
      const traversalMap = await app.inject({
        method: "GET",
        url: `/api/maps/${encodeURIComponent("../evil")}`
      });
      expect(traversalMap.statusCode).toBe(400);
      const traversalMapBody = traversalMap.json();
      expect(traversalMapBody.errors[0].code).toBe("bad_request");
      expect(JSON.stringify(traversalMapBody.errors)).not.toContain(tempRoot);

      const traversalExport = await app.inject({
        method: "GET",
        url: `/api/exports/${encodeURIComponent("../secret.png")}`
      });
      expect(traversalExport.statusCode).toBe(400);
      const traversalExportBody = traversalExport.json();
      expect(traversalExportBody.errors[0].code).toBe("bad_request");
      expect(JSON.stringify(traversalExportBody.errors)).not.toContain(tempRoot);

      const backslashExport = await app.inject({
        method: "GET",
        url: `/api/exports/${encodeURIComponent("..\\secret.png")}`
      });
      expect(backslashExport.statusCode).toBe(400);
      expect(backslashExport.json().errors[0].code).toBe("bad_request");
    } finally {
      await app.close();
    }
  });

  it("serves the built web app and preserves api routes", async () => {
    const { createServer } = await loadApi(tempRoot);
    const app = await createServer();
    try {
      const index = await app.inject({
        method: "GET",
        url: "/"
      });
      expect(index.statusCode).toBe(200);
      expect(index.headers["content-type"]).toContain("text/html");
      expect(index.body).toContain("<div id=\"root\"></div>");

      const appRoute = await app.inject({
        method: "GET",
        url: "/maps/demo"
      });
      expect(appRoute.statusCode).toBe(200);
      expect(appRoute.body).toContain("<div id=\"root\"></div>");

      const api = await app.inject({
        method: "GET",
        url: "/api/health"
      });
      expect(api.statusCode).toBe(200);
      const apiBody = api.json();
      expect(apiBody.result.status).toBe("ok");
    } finally {
      await app.close();
    }
  });
});
