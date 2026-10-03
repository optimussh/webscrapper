/**
 * CLI entry: npx tsx src/crawler/run-job.ts <jobId>
 * Runs outside the Next.js request lifecycle so long crawls survive.
 */
import { clearWorkerPid } from "../lib/jobs";
import { runCrawlJob } from "./engine";

async function main() {
  const jobId = process.argv[2];
  if (!jobId) {
    console.error("Usage: tsx src/crawler/run-job.ts <jobId>");
    process.exit(1);
  }

  try {
    await runCrawlJob(jobId);
    await clearWorkerPid(jobId);
    process.exit(0);
  } catch (err) {
    console.error(err);
    await clearWorkerPid(jobId);
    process.exit(1);
  }
}

void main();
