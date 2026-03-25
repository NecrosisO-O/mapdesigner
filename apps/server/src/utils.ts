import crypto from "node:crypto";

export function slugify(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9\u4e00-\u9fa5]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48);
}

export function createMapId(name: string): string {
  const base = slugify(name) || "map";
  const suffix = crypto.randomBytes(3).toString("hex");
  return `${base}-${suffix}`;
}

export function createEnvelope<T>(input: {
  result?: T;
  warnings?: unknown[];
  errors?: unknown[];
}) {
  return {
    ok: (input.errors ?? []).length === 0,
    result: input.result,
    warnings: input.warnings ?? [],
    errors: input.errors ?? []
  };
}
