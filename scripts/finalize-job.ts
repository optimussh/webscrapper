import { finalizeJob } from "../src/crawler/engine";

async function main() {
  const jobId = process.argv[2];
  if (!jobId) {
    console.error("Usage: tsx scripts/finalize-job.ts <jobId>");
    process.exit(1);
  }

  console.log("Finalizing job:", jobId);
  const t0 = Date.now();
  const res = await finalizeJob(jobId);
  console.log("Finalized successfully in", Date.now() - t0, "ms");
  console.log("Status:", res.status);
  console.log("Pages:", res.progress.pagesCrawled);
  console.log("Message:", res.progress.message);
}

main().catch((err) => {
  console.error("Finalize failed:", err);
  process.exit(1);
});
