const base = process.argv[2] ?? "http://127.0.0.1:3010";
const headers = {
  "Content-Type": "application/json",
  Authorization: "Bearer " + process.env.MAPDESIGNER_TOKEN
};
const created = await (
  await fetch(base + "/api/maps", {
    method: "POST",
    headers,
    body: JSON.stringify({ name: "容器导出验收" })
  })
).json();
if (!created.ok) throw new Error(JSON.stringify(created));
const painted = await (
  await fetch(base + "/api/maps/" + created.result.document.meta.id + "/commands", {
    method: "POST",
    headers,
    body: JSON.stringify({
      commands: [
        {
          action: "set_cell",
          target: { row: 0, col: 0 },
          changes: { terrain: "plain", biome: "grassland" }
        },
        {
          action: "set_cell",
          target: { row: 0, col: 1 },
          changes: { terrain: "lake", biome: "freshwater" }
        }
      ]
    })
  })
).json();
if (!painted.ok) throw new Error(JSON.stringify(painted));
const started = await (
  await fetch(base + "/api/jobs/export", {
    method: "POST",
    headers,
    body: JSON.stringify({
      kind: "png",
      mapId: created.result.document.meta.id,
      options: {
        preset: "reference",
        title: "容器中文成图验收",
        caption: "图例、方向与格距",
        includeLegend: true,
        northArrow: true,
        gridScale: true
      }
    })
  })
).json();
if (!started.ok) throw new Error(JSON.stringify(started));
for (let i = 0; i < 100; i++) {
  const status = await (await fetch(base + "/api/jobs/" + started.result.id, { headers })).json();
  if (status.result?.state === "failed") throw new Error(status.result.error);
  if (status.result?.state === "done") {
    const download = await fetch(base + status.result.result.downloadUrl);
    const disposition = download.headers.get("content-disposition") ?? "";
    if (!disposition.includes("filename*=UTF-8"))
      throw new Error("Missing encoded download filename");
    if (!download.ok || (await download.arrayBuffer()).byteLength < 100)
      throw new Error("PNG download failed");
    console.log("Container worker and PNG download passed");
    break;
  }
  if (i === 99) throw new Error("Container job timed out");
  await new Promise((resolve) => setTimeout(resolve, 100));
}

const previewJob = await (
  await fetch(base + "/api/jobs/export", {
    method: "POST",
    headers,
    body: JSON.stringify({
      kind: "preview",
      mapId: created.result.document.meta.id,
      options: { title: "容器中文预览", includeLegend: true, scale: 1 }
    })
  })
).json();
if (!previewJob.ok) throw new Error(JSON.stringify(previewJob));
for (let attempt = 0; attempt < 100; attempt++) {
  const status = (
    await (await fetch(base + "/api/jobs/" + previewJob.result.id, { headers })).json()
  ).result;
  if (status.state === "failed") throw new Error(status.error);
  if (status.state === "done") {
    if (!status.result.image.startsWith("data:image/png;base64,") || !status.result.width)
      throw new Error("Preview failed");
    console.log("Container preview and composition passed");
    break;
  }
  if (attempt === 99) throw new Error("Preview job timed out");
  await new Promise((resolve) => setTimeout(resolve, 100));
}
