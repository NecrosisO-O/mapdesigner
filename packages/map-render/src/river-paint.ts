import { escapeXml } from "./presentation.js";
import type { MapScene, RiverBodyLayout } from "./types.js";

/** Connected water is painted once per style; crossings remain independent components. */
export function paintRiverWater(scene: MapScene): string {
  const groups = new Map<string, RiverBodyLayout[]>();
  for (const body of scene.riverBodies) {
    const key = (body.preview ? "preview:" : "") + body.networkId;
    const group = groups.get(key) ?? [];
    group.push(body);
    groups.set(key, group);
  }
  const ordered = [...groups.values()].sort(
    (a, b) =>
      Math.max(...a.map((v) => v.widthRange.max)) - Math.max(...b.map((v) => v.widthRange.max)) ||
      a[0]!.riverId.localeCompare(b[0]!.riverId)
  );
  const bounds = `x="0" y="0" width="${scene.width}" height="${scene.height}"`;
  const defs = [
    `<mask id="river-land" maskUnits="userSpaceOnUse" ${bounds}><rect ${bounds} fill="white"/><path d="${scene.water.surfacePath}" fill="black"/></mask>`
  ];
  const bodies: string[] = [];
  ordered.forEach((group, index) => {
    const styles = new Map<string, RiverBodyLayout[]>();
    for (const body of group) {
      const key = body.color + ":" + body.opacity;
      const items = styles.get(key) ?? [];
      items.push(body);
      styles.set(key, items);
    }
    const layers = [...styles.values()].sort(
      (a, b) =>
        Math.max(...a.map((v) => v.widthRange.max)) - Math.max(...b.map((v) => v.widthRange.max)) ||
        a[0]!.riverId.localeCompare(b[0]!.riverId)
    );
    const first = group[0]!;
    let content = first.preview
      ? ""
      : `<path data-river-layer="bank" d="${group.map((b) => b.bankPath ?? "").join(" ")}" fill="${first.bankColor}" opacity=".46"/>`;
    layers.forEach((layer, i) => {
      const sample = layer[0]!,
        id = `river-priority-${index}-${i}`;
      const later = layers
        .slice(i + 1)
        .flat()
        .map((b) => b.bodyPath)
        .join(" ");
      if (later)
        defs.push(
          `<mask id="${id}" maskUnits="userSpaceOnUse" ${bounds}><rect ${bounds} fill="white"/><path d="${later}" fill="black"/></mask>`
        );
      content += `<path data-river-layer="body" data-river-id="${escapeXml(sample.riverId)}" data-river-name="${escapeXml(sample.riverName)}"${sample.preview ? ' data-river-preview="true"' : ""}${layer.some((b) => b.connectedStart) ? ' data-river-connected-start="true"' : ""}${layer.some((b) => b.connectedEnd) ? ' data-river-connected-end="true"' : ""} d="${layer.map((b) => b.bodyPath).join(" ")}" fill="${escapeXml(sample.color)}" opacity="${sample.preview ? Math.min(0.52, sample.opacity * 0.66) : sample.opacity}"${later ? ` mask="url(#${id})"` : ""}/>`;
    });
    if (scene.options.mapStyle === "classic-v1" && group.length === 1 && first.highlightPath)
      content += `<path data-river-layer="highlight" d="${first.highlightPath}" fill="none" stroke="${first.highlightColor}" stroke-width="${first.highlightWidth}" stroke-linecap="round" opacity=".2"/>`;
    bodies.push(`<g data-river-network="${escapeXml(first.networkId)}">${content}</g>`);
  });
  const mouthCut = scene.riverBodies
    .filter((b) => !b.preview)
    .map((b) => b.bodyPath)
    .join(" ");
  defs.push(
    `<mask id="shore-river-gaps" maskUnits="userSpaceOnUse" ${bounds}><rect ${bounds} fill="white"/><path d="${mouthCut}" fill="black"/></mask>`
  );
  const shore = scene.options.includeTerrain
    ? `<path data-water-shore="true" d="${scene.water.shorePath}" fill="none" stroke="#486E77" stroke-width="${(scene.options.size / 36) * 1.2}" opacity=".7" mask="url(#shore-river-gaps)"/>`
    : "";
  return (
    "<defs>" +
    defs.join("") +
    "</defs>" +
    shore +
    '<g mask="url(#river-land)">' +
    bodies.join("") +
    "</g>"
  );
}
