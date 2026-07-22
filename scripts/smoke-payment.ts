/**
 * Smoke: 2 product details → payment UI capture (no payment).
 */
import { createJob, loadJobArtifacts, jobDir } from "../src/lib/jobs";
import { runCrawlJob } from "../src/crawler/engine";
import fs from "fs";
import path from "path";

async function main() {
  // Start on a single detail so crawl is tiny, paymentCapture still runs on that URL
  const job = await createJob({
    startUrl: "https://fortun.unsin.co.kr/intro.php?cid=2508",
    siteType: "list-detail",
    features: {
      structure: true,
      extract: true,
      archive: true,
      paymentCapture: true,
    },
    scope: "site",
    detailUrlIncludes: ["intro.php?cid="],
    limits: { maxPages: 2, maxDepth: 0 },
    extractors: [
      { name: "title", selector: "h2", attr: "text" },
      { name: "price", selector: "em.price", attr: "text" },
    ],
  });

  console.log("job", job.id);
  await runCrawlJob(job.id);
  const a = await loadJobArtifacts(job.id);
  console.log("status", a.meta.status, a.meta.progress.message);
  console.log("summary", a.summary);
  console.log("payment", JSON.stringify(a.payment, null, 2));

  const payDir = path.join(jobDir(job.id), "payment");
  console.log(
    "payment files",
    fs.existsSync(payDir) ? fs.readdirSync(payDir) : "missing",
  );

  const ok = a.payment?.some((p) => p.ok && /buycash/i.test(p.paymentUrl || ""));
  if (!ok) {
    console.error("FAIL: no successful payment capture");
    process.exit(1);
  }
  console.log("OK");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
