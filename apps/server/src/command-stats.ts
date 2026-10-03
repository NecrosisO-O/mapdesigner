import type { MapCommand, CellChangeDetail } from "@mapdesigner/map-core";
import type { ApplyChangeStats, ApplyValueSummary } from "./command-types.js";

function incrementCount(bucket: Record<string, number>, key: string | null | undefined): void {
  if (!key) {
    return;
  }
  bucket[key] = (bucket[key] ?? 0) + 1;
}

export function buildApplyChangeStats(
  commands: MapCommand[],
  changes: CellChangeDetail[]
): ApplyChangeStats {
  const terrainSummary: ApplyValueSummary = { before: {}, after: {} };
  const biomeSummary: ApplyValueSummary = { before: {}, after: {} };
  let createdCount = 0;
  let updatedCount = 0;
  let clearedCount = 0;
  let riverCreatedCount = 0;
  let riverUpdatedCount = 0;
  let riverDeletedCount = 0;

  for (const change of changes) {
    const beforeDesigned = change.before?.status === "designed";
    const afterDesigned = change.after?.status === "designed";

    if (!beforeDesigned && afterDesigned) {
      createdCount += 1;
    } else if (beforeDesigned && !afterDesigned) {
      clearedCount += 1;
    } else if (beforeDesigned && afterDesigned) {
      updatedCount += 1;
    }

    incrementCount(terrainSummary.before, beforeDesigned ? change.before?.terrain : null);
    incrementCount(terrainSummary.after, afterDesigned ? change.after?.terrain : null);
    incrementCount(biomeSummary.before, beforeDesigned ? change.before?.biome : null);
    incrementCount(biomeSummary.after, afterDesigned ? change.after?.biome : null);
  }

  for (const command of commands) {
    switch (command.action) {
      case "create_river":
        riverCreatedCount += 1;
        break;
      case "update_river":
      case "set_river_path":
      case "set_river_width":
        riverUpdatedCount += 1;
        break;
      case "delete_river":
        riverDeletedCount += 1;
        break;
      default:
        break;
    }
  }

  return {
    command_count: commands.length,
    changed_count: changes.length,
    created_count: createdCount,
    updated_count: updatedCount,
    cleared_count: clearedCount,
    feature_stats: {
      river_created_count: riverCreatedCount,
      river_updated_count: riverUpdatedCount,
      river_deleted_count: riverDeletedCount
    },
    terrain_summary: terrainSummary,
    biome_summary: biomeSummary
  };
}
