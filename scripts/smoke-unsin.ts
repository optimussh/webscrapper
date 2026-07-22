/**
 * Smoke: list page (www) → detail (fortun.unsin.co.kr) with site scope.
 */
import { createJob, loadJobArtifacts } from "../src/lib/jobs";
import { runCrawlJob } from "../src/crawler/engine";

async function main() {
  const job = await createJob({
    startUrl: "https://www.unsin.co.kr/unse/fortun/submain/result?ca2=37",
    siteType: "list-detail",
    features: { structure: true, extract: true, archive: true },
    scope: "site",
    listLinkSelector: ".free-cont a",
    detailUrlIncludes: ["intro.php?cid="],
    limits: { maxPages: 8, maxDepth: 1 },
    extractors: [
      { name: "title", selector: "h2", attr: "text" },
      { name: "price", selector: "em.price", attr: "text" },
      { name: "sections", selector: "h3", attr: "text", multiple: true },
    ],
  });

  console.log("job", job.id);
  await runCrawlJob(job.id);
  const a = await loadJobArtifacts(job.id);
  console.log("status", a.meta.status, a.meta.error || "");
  console.log(
    "pages",
    a.pages?.map((p) => p.url),
  );
  const details = (a.pages || []).filter((p) => p.url.includes("fortun.unsin.co.kr"));
  console.log("detail pages", details.length);
  const detailExtract = (a.extract || []).filter((e) =>
    e.url.includes("fortun.unsin.co.kr"),
  );
  console.log(
    "detail extract sample",
    JSON.stringify(detailExtract[0], null, 2)?.slice(0, 800),
  );

  if (!details.length) {
    console.error("FAIL: no fortun.unsin.co.kr detail pages crawled");
    process.exit(1);
  }
  console.log("OK");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
