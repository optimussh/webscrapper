/**
 * Mirrors https://example.com with wget and with the node fallback,
 * then checks the AI brief tells agents not to copy source files.
 */
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { writeAiBrief } from "../src/lib/ai-brief";
import type { PageStructure } from "../src/lib/types";
import { captureDesignMirror } from "../src/lib/wget-mirror";

const page: PageStructure = {
  url: "https://example.com/",
  title: "Example Domain",
  headings: [{ level: 1, text: "Example Domain" }],
  navLinks: [],
  internalLinks: [],
  externalLinks: [],
  forms: [],
  images: 0,
  wordCount: 30,
  depth: 0,
};

async function check(root: string, label: string, forceNode: boolean) {
  await fs.rm(root, { recursive: true, force: true });
  await fs.mkdir(root, { recursive: true });
  const report = await captureDesignMirror({
    jobRoot: root,
    pageUrls: ["https://example.com/"],
    forceNode,
  });
  console.log(label, JSON.stringify({ engine: report.engine, files: report.files, note: report.note }));
  if (report.files < 1) {
    throw new Error(`${label} mirrored 0 files`);
  }
  const guidePath = path.join(root, "ai-brief", "GUIDE.md");
  await writeAiBrief(root, {
    startUrl: "https://example.com/",
    siteType: "static",
    pages: [page],
    mirror: report,
  });
  const guide = await fs.readFile(guidePath, "utf8");
  const start = await fs.readFile(path.join(root, "START-HERE.md"), "utf8");
  if (!guide.includes("Do not copy")) throw new Error(`${label} guide missing copy rule`);
  if (!guide.includes("OFL")) throw new Error(`${label} guide missing font rule`);
  if (!start.includes("GUIDE.md")) throw new Error(`${label} missing START-HERE`);
  const observations = await fs.readFile(
    path.join(root, "reference", "design-observations.json"),
    "utf8",
  );
  if (!observations.includes("Observation only")) throw new Error(`${label} observations unmarked`);
}

async function main() {
  const base = path.join(os.tmpdir(), "webscrapper-smoke-mirror");
  await check(base, "wget", false);
  await check(`${base}-node`, "node", true);
  console.log("OK");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
