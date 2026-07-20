import fs from "fs/promises";
import path from "path";
import JSZip from "jszip";
import { jobDir } from "./jobs";

async function addDir(zip: JSZip, dir: string, prefix: string): Promise<void> {
  const entries = await fs.readdir(dir, { withFileTypes: true });
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    const name = prefix ? `${prefix}/${entry.name}` : entry.name;
    if (entry.isDirectory()) {
      await addDir(zip, full, name);
    } else {
      const data = await fs.readFile(full);
      zip.file(name, data);
    }
  }
}

export async function zipJobFolder(jobId: string): Promise<Buffer> {
  const dir = jobDir(jobId);
  await fs.access(dir);
  const zip = new JSZip();
  await addDir(zip, dir, "");
  const out = await zip.generateAsync({
    type: "nodebuffer",
    compression: "DEFLATE",
    compressionOptions: { level: 6 },
  });
  return out as Buffer;
}
