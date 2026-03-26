import cors from "@fastify/cors";
import Fastify, { type FastifyInstance } from "fastify";
import type { ExportRenderOptions, MapCommand } from "@mapdesigner/map-core";
import { SERVER_PORT } from "./config.js";
import {
  applyCommands,
  createMap,
  deleteMap,
  duplicateMap,
  exportJson,
  exportPng,
  getMap,
  importMap,
  listMaps,
  saveMapAs,
  saveMap
} from "./service.js";
import { createEnvelope } from "./utils.js";

export async function createServer(): Promise<FastifyInstance> {
  const app = Fastify({ logger: false });
  await app.register(cors, { origin: true });

  app.get("/api/health", async () => createEnvelope({ result: { status: "ok", port: SERVER_PORT } }));

  app.get("/api/maps", async () => createEnvelope({ result: await listMaps() }));

  app.get<{ Params: { id: string } }>("/api/maps/:id", async (request, reply) => {
    try {
      return createEnvelope({ result: await getMap(request.params.id) });
    } catch (error) {
      reply.status(404);
      return createEnvelope({
        errors: [{ code: "map_not_found", message: (error as Error).message, severity: "invalid" }]
      });
    }
  });

  app.post<{ Body: { name: string; description?: string; id?: string } }>("/api/maps", async (request, reply) => {
    try {
      return createEnvelope({ result: await createMap(request.body) });
    } catch (error) {
      reply.status(400);
      return createEnvelope({
        errors: [{ code: "create_failed", message: (error as Error).message, severity: "invalid" }]
      });
    }
  });

  app.put<{ Params: { id: string }; Body: { document: Awaited<ReturnType<typeof getMap>>["document"]; expectedRevision: number } }>(
    "/api/maps/:id",
    async (request, reply) => {
      try {
        if (request.params.id !== request.body.document.meta.id) {
          reply.status(400);
          return createEnvelope({
            errors: [{ code: "id_mismatch", message: "path id and document.meta.id must match", severity: "invalid" }]
          });
        }
        return createEnvelope({
          result: await saveMap({
            document: request.body.document,
            expectedRevision: request.body.expectedRevision
          })
        });
      } catch (error) {
        reply.status(409);
        return createEnvelope({
          errors: [{ code: "save_failed", message: (error as Error).message, severity: "invalid" }]
        });
      }
    }
  );

  app.post<{ Params: { id: string } }>("/api/maps/:id/duplicate", async (request, reply) => {
    try {
      return createEnvelope({ result: await duplicateMap(request.params.id) });
    } catch (error) {
      reply.status(400);
      return createEnvelope({
        errors: [{ code: "duplicate_failed", message: (error as Error).message, severity: "invalid" }]
      });
    }
  });

  app.post<{
    Params: { id: string };
    Body: { document: Awaited<ReturnType<typeof getMap>>["document"]; name: string; id?: string };
  }>("/api/maps/:id/save-as", async (request, reply) => {
    try {
      if (request.params.id !== request.body.document.meta.id) {
        reply.status(400);
        return createEnvelope({
          errors: [{ code: "id_mismatch", message: "path id and document.meta.id must match", severity: "invalid" }]
        });
      }
      return createEnvelope({
        result: await saveMapAs({
          document: request.body.document,
          name: request.body.name,
          id: request.body.id
        })
      });
    } catch (error) {
      reply.status(400);
      return createEnvelope({
        errors: [{ code: "save_as_failed", message: (error as Error).message, severity: "invalid" }]
      });
    }
  });

  app.delete<{ Params: { id: string } }>("/api/maps/:id", async (request, reply) => {
    try {
      await deleteMap(request.params.id);
      return createEnvelope({ result: { deleted: true } });
    } catch (error) {
      reply.status(404);
      return createEnvelope({
        errors: [{ code: "delete_failed", message: (error as Error).message, severity: "invalid" }]
      });
    }
  });

  app.post<{ Body: { content: string; generateNewId?: boolean } }>("/api/maps/import", async (request, reply) => {
    try {
      const result = await importMap(request.body);
      return createEnvelope({ result: result.map, warnings: result.warnings });
    } catch (error) {
      reply.status(400);
      return createEnvelope({
        errors: [{ code: "import_failed", message: (error as Error).message, severity: "invalid" }]
      });
    }
  });

  app.post<{ Params: { id: string } }>("/api/maps/:id/export-json", async (request, reply) => {
    try {
      return createEnvelope({ result: await exportJson(request.params.id) });
    } catch (error) {
      reply.status(400);
      return createEnvelope({
        errors: [{ code: "export_json_failed", message: (error as Error).message, severity: "invalid" }]
      });
    }
  });

  app.post<{ Params: { id: string }; Body: Partial<ExportRenderOptions> }>("/api/maps/:id/export-png", async (request, reply) => {
    try {
      return createEnvelope({ result: await exportPng(request.params.id, request.body ?? {}) });
    } catch (error) {
      reply.status(400);
      return createEnvelope({
        errors: [{ code: "export_png_failed", message: (error as Error).message, severity: "invalid" }]
      });
    }
  });

  app.post<{ Params: { id: string }; Body: { commands: MapCommand[] } }>("/api/maps/:id/apply", async (request, reply) => {
    try {
      const result = await applyCommands(request.params.id, request.body.commands);
      return createEnvelope({ result: result.map, warnings: result.warnings });
    } catch (error) {
      reply.status(400);
      return createEnvelope({
        errors: [{ code: "apply_failed", message: (error as Error).message, severity: "invalid" }]
      });
    }
  });

  return app;
}
