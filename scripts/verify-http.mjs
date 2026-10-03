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
const started = await (
  await fetch(base + "/api/jobs/export", {
    method: "POST",
    headers,
    body: JSON.stringify({
      kind: "png",
      mapId: created.result.document.meta.id,
      options: { preset: "reference" }
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
