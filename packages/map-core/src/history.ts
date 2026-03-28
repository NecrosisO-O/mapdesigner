import { buildActiveCells } from "./activity.js";
import { cloneDocument, getHistoryLimitForDesignedCellCount, normalizeDocument } from "./serialization.js";
import type {
  HistorySource,
  MapDocument,
  MapRuntimeState,
  RuntimeHistoryEntry
} from "./types.js";

export function pushHistory(
  state: MapRuntimeState,
  before: MapDocument,
  after: MapDocument,
  label: string,
  source: HistorySource = "system"
): MapRuntimeState {
  const normalized = normalizeDocument(after);
  const nextLimit = getHistoryLimitForDesignedCellCount(normalized.cells.length);
  const entry: RuntimeHistoryEntry = {
    label,
    source,
    timestamp: new Date().toISOString(),
    before: cloneDocument(before),
    after: cloneDocument(after)
  };
  const past = [...state.history.past, entry];
  const boundedPast = past.slice(-nextLimit);
  return {
    document: normalized,
    activeCells: buildActiveCells(normalized),
    history: {
      past: boundedPast,
      future: [],
      limit: nextLimit
    }
  };
}

export function undo(state: MapRuntimeState): MapRuntimeState {
  const previous = state.history.past.at(-1);
  if (!previous) {
    return state;
  }
  const past = state.history.past.slice(0, -1);
  const restored = normalizeDocument(previous.before);
  const nextLimit = getHistoryLimitForDesignedCellCount(restored.cells.length);
  return {
    document: restored,
    activeCells: buildActiveCells(restored),
    history: {
      past: past.slice(-nextLimit),
      future: [previous, ...state.history.future],
      limit: nextLimit
    }
  };
}

export function redo(state: MapRuntimeState): MapRuntimeState {
  const next = state.history.future[0];
  if (!next) {
    return state;
  }
  const restored = normalizeDocument(next.after);
  const nextLimit = getHistoryLimitForDesignedCellCount(restored.cells.length);
  return {
    document: restored,
    activeCells: buildActiveCells(restored),
    history: {
      past: [...state.history.past, next].slice(-nextLimit),
      future: state.history.future.slice(1),
      limit: nextLimit
    }
  };
}
