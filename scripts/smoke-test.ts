import { createJob, loadJobArtifacts } from "../src/lib/jobs";
import { runCrawlJob } from "../src/crawler/engine";
import { zipJobFolder } from "../src/lib/zip";

async function main() {
  const job = await createJob({
    startUrl: "https://example.com",
    siteType: "static",
    features: { structure: true, extract: true, archive: true },
    extractors: [{ name: "h1", selector: "h1", attr: "text" }],
    limits: { maxPages: 5, maxDepth: 1 },
  });
  console.log("job", job.id);
  await runCrawlJob(job.id);
  const a = await loadJobArtifacts(job.id);
  console.log("status", a.meta.status);
  console.log("pages", a.pages?.length, a.pages?.[0]?.title);
  console.log("extract", JSON.stringify(a.extract));
  const zip = await zipJobFolder(job.id);
  console.log("zip bytes", zip.length);
  if (a.meta.status !== "completed" || !a.pages?.length) {
    process.exitCode = 1;
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
