import { createHash } from "node:crypto";
import { readFile, stat, writeFile } from "node:fs/promises";
import path from "node:path";

const baseUrl = process.env.VAULTFS_BASE_URL?.replace(/\/$/, "");
const dockyardId = process.env.VAULTFS_DOCKYARD_ID;
const apiKey = process.env.VAULTFS_API_KEY;
const sourcePath = process.env.FILE_SMOKE_TEST_PATH;
const downloadPath = process.env.FILE_SMOKE_DOWNLOAD_PATH;

for (const [key, value] of Object.entries({ VAULTFS_BASE_URL: baseUrl, VAULTFS_DOCKYARD_ID: dockyardId, VAULTFS_API_KEY: apiKey, FILE_SMOKE_TEST_PATH: sourcePath, FILE_SMOKE_DOWNLOAD_PATH: downloadPath })) {
  if (!value) throw new Error(`${key} must be set for the storage smoke test`);
}
if (path.resolve(sourcePath!) === path.resolve(downloadPath!)) throw new Error("Input and download paths must be different");

const info = await stat(sourcePath!);
if (!info.isFile() || info.size <= 0) throw new Error("The smoke-test input must be a non-empty file");
const bytes = await readFile(sourcePath!);
const headers = { "X-API-Key": apiKey! };
let createdFileId: string | undefined;

async function call(route: string, init: RequestInit = {}) {
  const response = await fetch(`${baseUrl}${route}`, { ...init, headers: { ...headers, ...init.headers } });
  if (!response.ok) {
    const body = await response.text();
    throw new Error(`${init.method ?? "GET"} ${route} failed (${response.status}): ${body}`);
  }
  return response;
}

try {
  const form = new FormData();
  form.append("file", new Blob([new Uint8Array(bytes)]), path.basename(sourcePath!));
  const uploaded = await (await call(`/api/dockyard/${encodeURIComponent(dockyardId!)}/files`, { method: "POST", body: form })).json() as any;
  const file = uploaded.data?.[0];
  if (!file?.id) throw new Error("Upload response did not contain a file ID");
  createdFileId = file.id;
  console.log(`Upload: ${file.id} (${file.sizeBytes} bytes, ${file.contentType})`);

  const listing = await (await call(`/api/dockyard/${encodeURIComponent(dockyardId!)}/files?limit=100`)).json() as any;
  if (!listing.data?.files?.some((item: { id: string }) => item.id === file.id)) throw new Error("Uploaded file was not returned by the list endpoint");
  console.log("List: file is present");

  const download = await call(`/api/dockyard/${encodeURIComponent(dockyardId!)}/files/${encodeURIComponent(file.id)}/download`);
  const downloaded = Buffer.from(await download.arrayBuffer());
  await writeFile(downloadPath!, downloaded, { flag: "wx" });
  console.log(`Download: wrote ${downloaded.length} bytes to ${downloadPath}`);

  const localChecksum = createHash("sha256").update(downloaded).digest("hex");
  const verified = await (await call(`/api/dockyard/${encodeURIComponent(dockyardId!)}/files/${encodeURIComponent(file.id)}/verify`, { method: "POST" })).json() as any;
  if (!verified.data?.matches || verified.data.actualSha256 !== localChecksum) throw new Error("Checksum verification failed");
  console.log(`Verify: SHA-256 ${localChecksum}`);

  await call(`/api/dockyard/${encodeURIComponent(dockyardId!)}/files/${encodeURIComponent(file.id)}`, { method: "DELETE" });
  createdFileId = undefined;
  console.log("Delete: file removed from storage");
} catch (error) {
  if (createdFileId) {
    await call(`/api/dockyard/${encodeURIComponent(dockyardId!)}/files/${encodeURIComponent(createdFileId)}`, { method: "DELETE" }).catch(() => undefined);
  }
  throw error;
}
