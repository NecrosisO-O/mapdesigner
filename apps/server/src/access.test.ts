import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type { FastifyInstance } from "fastify";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

let root: string;
let app: FastifyInstance;
beforeEach(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), "mapdesigner-access-"));
  vi.stubEnv("MAPDESIGNER_ROOT", root);
  vi.stubEnv("HOST", "127.0.0.1");
  vi.stubEnv("MAPDESIGNER_TOKEN", "");
  vi.resetModules();
});
afterEach(async () => {
  await app?.close();
  (await import("./db.js")).closeDatabaseForTests();
  vi.unstubAllEnvs();
  await fs.rm(root, { recursive: true, force: true });
});

it("rejects foreign origins, malformed origins and rebinding hosts before writes", async () => {
  app = await (await import("./api.js")).createServer();
  for (const headers of [{ origin: "https://example.invalid" }, { origin: "invalid" }, { host: "example.invalid" }]) {
    const response = await app.inject({ method: "POST", url: "/api/maps", headers, payload: { name: "Forbidden" } });
    expect(response.statusCode).toBe(403);
    expect(response.json().ok).toBe(false);
  }
  expect((await app.inject({ method: "GET", url: "/api/maps" })).json().result).toEqual([]);
  expect((await app.inject({ method: "POST", url: "/api/maps", headers: { origin: "http://localhost:5173" }, payload: { name: "Local" } })).statusCode).toBe(200);
});

it("requires the configured token and keeps health checks available", async () => {
  vi.stubEnv("HOST", "0.0.0.0");
  vi.stubEnv("MAPDESIGNER_TOKEN", "test-token-for-private-network");
  const config = await import("./config.js");
  expect(() => config.validateListenConfig()).not.toThrow();
  app = await (await import("./api.js")).createServer();
  expect((await app.inject({ method: "GET", url: "/api/health" })).statusCode).toBe(200);
  expect((await app.inject({ method: "GET", url: "/api/maps" })).statusCode).toBe(401);
  expect((await app.inject({ method: "GET", url: "/api/maps", headers: { authorization: "Bearer wrong" } })).statusCode).toBe(401);
  expect((await app.inject({ method: "GET", url: "/api/maps", headers: { authorization: "Bearer test-token-for-private-network" } })).statusCode).toBe(200);
});

it("requires explicit authorization for network listening", async () => {
  vi.stubEnv("HOST", "0.0.0.0");
  const config = await import("./config.js");
  expect(() => config.validateListenConfig()).toThrow("MAPDESIGNER_TOKEN");
});
