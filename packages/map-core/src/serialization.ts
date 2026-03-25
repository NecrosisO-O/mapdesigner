import { buildActiveCells } from "./activity.js";
import type {
  DesignedCellRecord,
  MapDocument,
  MapMeta,
  MapRuntimeState
} from "./types.js";
import { validateMapDocument } from "./validation.js";

function sortCells(cells: DesignedCellRecord[]): DesignedCellRecord[] {
  return [...cells].sort((a, b) => {
    if (a.row !== b.row) {
      return a.row - b.row;
    }
    return a.col - b.col;
  });
}

function normalizeCell(cell: DesignedCellRecord): DesignedCellRecord {
  return {
    row: cell.row,
    col: cell.col,
    terrain: cell.terrain,
    biome: cell.biome ?? null,
    tags: [...new Set(cell.tags)].sort(),
    note: cell.note ?? ""
  };
}

export function cloneDocument(document: MapDocument): MapDocument {
  return structuredClone(document);
}

export function normalizeDocument(document: MapDocument): MapDocument {
  return {
    schema_version: 1,
    meta: normalizeMeta(document.meta),
    grid: {
      layout: "flat-top-even-q",
      origin: { row: 0, col: 0 }
    },
    cells: sortCells(document.cells.map(normalizeCell))
  };
}

export function normalizeMeta(meta: MapMeta): MapMeta {
  return {
    id: meta.id,
    name: meta.name,
    description: meta.description ?? "",
    tags: [...new Set(meta.tags ?? [])].sort(),
    created_at: meta.created_at,
    updated_at: meta.updated_at,
    revision: meta.revision
  };
}

export function createEmptyDocument(input: {
  id: string;
  name: string;
  description?: string;
  now?: string;
}): MapDocument {
  const now = input.now ?? new Date().toISOString();
  return normalizeDocument({
    schema_version: 1,
    meta: {
      id: input.id,
      name: input.name,
      description: input.description ?? "",
      tags: [],
      created_at: now,
      updated_at: now,
      revision: 1
    },
    grid: {
      layout: "flat-top-even-q",
      origin: { row: 0, col: 0 }
    },
    cells: []
  });
}

export function createRuntimeState(document: MapDocument): MapRuntimeState {
  const normalized = normalizeDocument(document);
  return {
    document: normalized,
    activeCells: buildActiveCells(normalized),
    history: {
      past: [],
      future: [],
      limit: 100
    }
  };
}

export function parseDocument(json: string): { document?: MapDocument; errors: ReturnType<typeof validateMapDocument> } {
  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch {
    return {
      errors: [
        {
          code: "invalid_json",
          message: "file is not valid JSON",
          severity: "invalid",
          target: "root"
        }
      ]
    };
  }

  const errors = validateMapDocument(parsed);
  if (errors.some((entry) => entry.severity === "invalid")) {
    return { errors };
  }

  return {
    document: normalizeDocument(parsed as MapDocument),
    errors
  };
}

export function stringifyDocument(document: MapDocument): string {
  return JSON.stringify(normalizeDocument(document), null, 2);
}
