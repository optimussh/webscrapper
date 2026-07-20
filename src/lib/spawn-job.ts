import { spawn } from "child_process";
import path from "path";

/**
 * Start crawl worker as a detached child so the HTTP request can return immediately.
 */
export function spawnCrawlJob(jobId: string): void {
  const script = path.join(process.cwd(), "src", "crawler", "run-job.ts");
  const isWin = process.platform === "win32";

  const child = spawn(
    isWin ? "npx.cmd" : "npx",
    ["tsx", script, jobId],
    {
      cwd: process.cwd(),
      detached: true,
      stdio: "ignore",
      windowsHide: true,
      env: {
        ...process.env,
        // Ensure Playwright browsers path is inherited
      },
    },
  );

  child.unref();
}
