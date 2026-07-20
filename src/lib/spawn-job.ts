import { spawn } from "child_process";
import path from "path";

/**
 * Start crawl worker as a detached child so the HTTP request can return immediately.
 */
export function spawnCrawlJob(jobId: string): void {
  const script = path.join(process.cwd(), "src", "crawler", "run-job.ts");
  const isWin = process.platform === "win32";

  // On Windows, shell + npx is the reliable way to launch tsx workers.
  const child = spawn(
    isWin ? "npx" : "npx",
    ["tsx", script, jobId],
    {
      cwd: process.cwd(),
      detached: !isWin,
      stdio: "ignore",
      windowsHide: true,
      shell: isWin,
      env: { ...process.env },
    },
  );

  child.on("error", (err) => {
    console.error("[spawnCrawlJob] failed to start worker:", err);
  });

  if (!isWin) {
    child.unref();
  } else {
    // Still unref so the Next process doesn't wait on the child
    child.unref();
  }
}
