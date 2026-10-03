import fs from "node:fs/promises";
import path from "node:path";
import { CheerioCrawler, Configuration, PlaywrightCrawler, RequestQueue } from "crawlee";
import { chromium } from "playwright";
import {
  analyzeHtml,
  buildSitemap,
  discoverLinks,
  discoverListDetailLinks,
  extractFromHtml,
  extractListItems,
} from "../lib/analyze";
import { writeAiBrief } from "../lib/ai-brief";
import {
  jobDir,
  readExtract,
  readJob,
  readPages,
  saveArchiveIndex,
  saveBenchmarkRecipe,
  saveExtract,
  saveHtml,
  saveMarkdown,
  saveMarkdownIndex,
  savePages,
  saveScreenshot,
  saveScreenshotIndex,
  saveSitemap,
  saveSummary,
  updateJob,
} from "../lib/jobs";
import { captureDesignMirror } from "../lib/wget-mirror";
import { htmlToMarkdown } from "../lib/markdown";
import { mergeExtractors } from "../lib/smart-extract";
import { fetchSitemapSeedUrls } from "../lib/sitemap-seed";
import type { CrawlScope, ExtractedPage, JobMeta, MirrorReport, PageStructure } from "../lib/types";
import { isInScope, normalizeUrl, shouldSkipUrl } from "../lib/url";
import {
  capturePaymentForDetails,
  isProductDetailUrl,
} from "./payment-capture";

type UserData = {
  depth: number;
  isDetail?: boolean;
};

function crawleeConfig() {
  return new Configuration({
    persistStorage: false,
    purgeOnStart: true,
  });
}

function scopeOf(meta: JobMeta): CrawlScope {
  return meta.input.scope ?? "site";
}

function concurrencyOf(meta: JobMeta, fallback: number): number {
  if (meta.input.features.polite) {
    return meta.input.limits.maxConcurrency ?? 1;
  }
  return fallback;
}

function delayMsOf(meta: JobMeta): number {
  if (!meta.input.features.polite) return 0;
  return meta.input.limits.requestDelayMs ?? 800;
}

async function politePause(meta: JobMeta): Promise<void> {
  const ms = delayMsOf(meta);
  if (ms > 0) await new Promise((r) => setTimeout(r, ms));
}

export async function runCrawlJob(jobId: string): Promise<void> {
  const meta = await readJob(jobId);
  if (!meta) throw new Error(`Job not found: ${jobId}`);

  const started = Date.now();
  const resume = !!meta.resume;
  const pages: PageStructure[] = resume ? await readPages(jobId) : [];
  const extracts: ExtractedPage[] = resume ? await readExtract(jobId) : [];
  const resumedCount = pages.length;
  const seen = new Set<string>();
  for (const page of pages) {
    const key = normalizeUrl(page.url) || page.url;
    seen.add(key);
    if (page.finalUrl) seen.add(normalizeUrl(page.finalUrl) || page.finalUrl);
  }

  await updateJob(jobId, {
    status: "running",
    resume: false,
    progress: {
      message: resume ? `Continuing from ${resumedCount} pages` : "Starting crawl",
      pagesCrawled: resumedCount,
      pagesEnqueued: Math.max(resumedCount, 1),
    },
  });

  // Always save reproducible plan (thin "recipe" — Browser Use idea without LLM)
  await saveBenchmarkRecipe(jobId, meta.input);

  const mdEntries: { url: string; title?: string; file: string }[] = [];
  const shotEntries: { url: string; title?: string; file: string }[] = [];
  const { input } = meta;
  const startUrl = normalizeUrl(input.startUrl) || input.startUrl;
  const maxPages = input.limits.maxPages;
  const maxDepth = input.limits.maxDepth;
  const scope = scopeOf(meta);
  const extractors = mergeExtractors(input.extractors, !!input.features.smartExtract);
  const doExtract = !!(input.features.extract || input.features.smartExtract) && extractors.length > 0;
  let sitemapSeedCount = 0;

  const recordPage = async (
    url: string,
    html: string,
    depth: number,
    extra?: {
      statusCode?: number;
      contentType?: string;
      finalUrl?: string;
      screenshotPng?: Buffer;
    },
  ) => {
    if (pages.length >= maxPages) return;
    const key = normalizeUrl(url) || url;
    if (seen.has(key)) return;
    seen.add(key);

    const structure = analyzeHtml(html, url, depth, {
      statusCode: extra?.statusCode,
      contentType: extra?.contentType,
      finalUrl: extra?.finalUrl,
    });

    if (input.features.markdown) {
      try {
        const md = htmlToMarkdown(html, url);
        const file = await saveMarkdown(jobId, url, md);
        structure.markdownFile = file;
        mdEntries.push({ url, title: structure.title, file });
      } catch (err) {
        console.error("markdown failed", url, err);
      }
    }

    if (input.features.screenshot && extra?.screenshotPng) {
      try {
        const file = await saveScreenshot(jobId, url, extra.screenshotPng);
        structure.screenshotFile = file;
        shotEntries.push({ url, title: structure.title, file });
      } catch (err) {
        console.error("screenshot save failed", url, err);
      }
    }

    pages.push(structure);

    if (doExtract) {
      if (input.listItemSelector) {
        const rows = extractListItems(html, url, input.listItemSelector, extractors);
        if (rows.length) {
          extracts.push(
            ...rows.map((r) => ({
              ...r,
              smart: !!input.features.smartExtract && !input.extractors?.length,
            })),
          );
        } else {
          extracts.push({
            url,
            data: extractFromHtml(html, url, extractors),
            smart: !!input.features.smartExtract,
          });
        }
      } else {
        extracts.push({
          url,
          data: extractFromHtml(html, url, extractors),
          smart: !!input.features.smartExtract,
        });
      }
    }

    if (input.features.archive) {
      await saveHtml(jobId, url, html);
    }

    await updateJob(jobId, {
      progress: {
        pagesCrawled: pages.length,
        pagesEnqueued: seen.size,
        currentUrl: url,
        message: `Crawled ${pages.length}/${maxPages}`,
      },
    });

    await savePages(jobId, pages);
    if (doExtract) await saveExtract(jobId, extracts);
  };

  const resumeSeeds = resume
    ? frontierFromSaved(pages, startUrl, scope, seen, maxDepth)
    : [];
  const requestBudget = Math.max(1, maxPages - resumedCount);

  try {
    if (input.siteType === "static") {
      await runCheerioCrawl(
        meta,
        startUrl,
        maxPages,
        maxDepth,
        scope,
        recordPage,
        pages,
        seen,
        resumeSeeds,
        requestBudget,
      );
    } else {
      await runPlaywrightCrawl(
        meta,
        startUrl,
        maxPages,
        maxDepth,
        scope,
        recordPage,
        pages,
        seen,
        resumeSeeds,
        requestBudget,
      );
    }

    // Static crawls cannot screenshot in-handler — second pass with Playwright
    const needShots = pages.filter((page) => !page.screenshotFile);
    if (input.features.screenshot && input.siteType === "static" && needShots.length) {
      await updateJob(jobId, {
        progress: {
          pagesCrawled: pages.length,
          pagesEnqueued: seen.size,
          message: `Screenshots 0/${needShots.length}`,
        },
      });
      await screenshotUrls(jobId, needShots, (done, total, url) => {
        void updateJob(jobId, {
          progress: {
            pagesCrawled: pages.length,
            pagesEnqueued: seen.size,
            currentUrl: url,
            message: `Screenshots ${done}/${total}`,
          },
        });
      }, shotEntries);
      await savePages(jobId, pages);
    }

    const sitemap = buildSitemap(pages, startUrl);
    await saveSitemap(jobId, sitemap);
    await savePages(jobId, pages);
    if (doExtract) await saveExtract(jobId, extracts);

    const markdownIndex = pages
      .filter((page) => page.markdownFile)
      .map((page) => ({ url: page.url, title: page.title, file: page.markdownFile! }));
    const screenshotIndex = pages
      .filter((page) => page.screenshotFile)
      .map((page) => ({ url: page.url, title: page.title, file: page.screenshotFile! }));
    if (markdownIndex.length) await saveMarkdownIndex(jobId, markdownIndex);
    if (screenshotIndex.length) await saveScreenshotIndex(jobId, screenshotIndex);

    let paymentOk = 0;
    let paymentFail = 0;
    if (input.features.paymentCapture && resumedCount === 0) {
      const detailUrls = pages.map((p) => p.url).filter(isProductDetailUrl);
      for (const row of extracts) {
        if (isProductDetailUrl(row.url)) detailUrls.push(row.url);
      }
      const uniqueDetails = [...new Set(detailUrls)];
      await updateJob(jobId, {
        progress: {
          pagesCrawled: pages.length,
          pagesEnqueued: seen.size,
          message: `Payment UI capture 0/${uniqueDetails.length}`,
        },
      });

      const paymentResults = await capturePaymentForDetails(
        jobId,
        uniqueDetails,
        (done, total, url) => {
          void updateJob(jobId, {
            progress: {
              pagesCrawled: pages.length,
              pagesEnqueued: seen.size,
              currentUrl: url,
              message: `Payment UI capture ${done + 1}/${total}`,
            },
          });
        },
      );
      paymentOk = paymentResults.filter((r) => r.ok).length;
      paymentFail = paymentResults.filter((r) => !r.ok).length;
    }

    // Re-read meta for sitemap seed count stored during crawl via progress message only —
    // keep count on a local var set by seed helper
    sitemapSeedCount = (meta as JobMeta & { _seedCount?: number })._seedCount ?? 0;

    let mirror = await mirrorDesign(
      jobId,
      input.features.wgetMirror,
      pages.slice(resumedCount),
      seen.size,
      pages.length,
    );
    if (!mirror) mirror = await readMirrorReport(jobId);
    let aiBrief = false;
    try {
      await writeAiBrief(jobDir(jobId), {
        startUrl,
        siteType: input.siteType,
        pages,
        mirror,
      });
      aiBrief = true;
    } catch (briefErr) {
      console.error("ai brief failed", briefErr);
    }

    await saveSummary(jobId, {
      id: jobId,
      startUrl,
      siteType: input.siteType,
      features: input.features,
      pagesCrawled: pages.length,
      completedAt: new Date().toISOString(),
      durationMs: Date.now() - started,
      paymentCaptured: paymentOk,
      paymentFailed: paymentFail,
      markdownCount: markdownIndex.length,
      screenshotCount: screenshotIndex.length,
      sitemapSeedCount,
      mirrorFiles: mirror?.files,
      mirrorBytes: mirror?.bytes,
      mirrorEngine: mirror?.engine,
      aiBrief,
    });

    if (input.features.archive) {
      const byUrl = new Map(
        extracts.map((e) => [
          e.url,
          {
            title:
              (typeof e.data.title === "string" && e.data.title) || undefined,
            price:
              (typeof e.data.price === "string" && e.data.price) || undefined,
          },
        ]),
      );
      await saveArchiveIndex(
        jobId,
        pages.map((p) => ({
          url: p.url,
          title: byUrl.get(p.url)?.title || p.title,
          price: byUrl.get(p.url)?.price,
        })),
      );
    }

    const extras: string[] = [];
    if (mdEntries.length) extras.push(`md ${mdEntries.length}`);
    if (shotEntries.length) extras.push(`shots ${shotEntries.length}`);
    if (input.features.paymentCapture) {
      extras.push(`payment ${paymentOk}/${paymentFail}`);
    }
    if (input.features.wgetMirror) extras.push("mirror");

    await updateJob(jobId, {
      status: "completed",
      progress: {
        pagesCrawled: pages.length,
        pagesEnqueued: seen.size,
        message: `Done — ${pages.length} pages${extras.length ? ` (${extras.join(", ")})` : ""}`,
      },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await updateJob(jobId, {
      status: "failed",
      error: message,
      progress: {
        pagesCrawled: pages.length,
        pagesEnqueued: seen.size,
        message: `Failed: ${message}`,
      },
    });
    if (pages.length) {
      await savePages(jobId, pages);
      await saveSitemap(jobId, buildSitemap(pages, startUrl));
      try {
        await writeAiBrief(jobDir(jobId), {
          startUrl,
          siteType: input.siteType,
          pages,
        });
      } catch (briefErr) {
        console.error("ai brief failed", briefErr);
      }
    }
    throw err;
  }
}

async function readMirrorReport(jobId: string): Promise<MirrorReport | undefined> {
  try {
    const raw = await fs.readFile(
      path.join(jobDir(jobId), "reference", "mirror", "report.json"),
      "utf8",
    );
    return JSON.parse(raw) as MirrorReport;
  } catch {
    return undefined;
  }
}

async function mirrorDesign(
  jobId: string,
  enabled: boolean | undefined,
  pages: PageStructure[],
  enqueued: number,
  pagesCrawled = pages.length,
): Promise<MirrorReport | undefined> {
  if (!enabled || !pages.length) return undefined;
  await updateJob(jobId, {
    progress: {
      pagesCrawled,
      pagesEnqueued: enqueued,
      message: "Mirroring design files (wget)",
    },
  });
  try {
    return await captureDesignMirror({
      jobRoot: jobDir(jobId),
      pageUrls: pages.map((page) => page.finalUrl || page.url),
    });
  } catch (err) {
    console.error("wget mirror failed", err);
    return {
      engine: "gnu-wget",
      command: "",
      exitCode: 1,
      files: 0,
      bytes: 0,
      skipped: [],
      note: err instanceof Error ? err.message : String(err),
    };
  }
}

async function screenshotUrls(
  jobId: string,
  pages: PageStructure[],
  onProgress: (done: number, total: number, url: string) => void,
  shotEntries: { url: string; title?: string; file: string }[],
): Promise<void> {
  const browser = await chromium.launch({ headless: true });
  try {
    const context = await browser.newContext({
      viewport: { width: 1280, height: 800 },
    });
    let done = 0;
    for (const p of pages) {
      onProgress(done, pages.length, p.url);
      try {
        const page = await context.newPage();
        await page.goto(p.url, { waitUntil: "domcontentloaded", timeout: 45000 });
        await page.waitForTimeout(500);
        const png = await page.screenshot({ fullPage: true, type: "png" });
        const file = await saveScreenshot(jobId, p.url, png);
        p.screenshotFile = file;
        shotEntries.push({ url: p.url, title: p.title, file });
        await page.close();
      } catch (err) {
        console.error("screenshot pass failed", p.url, err);
      }
      done += 1;
      onProgress(done, pages.length, p.url);
    }
    await context.close();
  } finally {
    await browser.close();
  }
}

function collectEnqueueUrls(
  meta: JobMeta,
  html: string,
  pageUrl: string,
  startUrl: string,
  scope: CrawlScope,
  _depth: number,
): string[] {
  const isListDetail = meta.input.siteType === "list-detail";
  if (isListDetail) {
    return discoverListDetailLinks(
      html,
      pageUrl,
      meta.input.listLinkSelector,
      meta.input.detailUrlIncludes,
      startUrl,
      scope,
    );
  }
  return discoverLinks(html, pageUrl, startUrl, scope);
}

function frontierFromSaved(
  saved: PageStructure[],
  startUrl: string,
  scope: CrawlScope,
  seen: Set<string>,
  maxDepth: number,
): { url: string; depth: number }[] {
  const out: { url: string; depth: number }[] = [];
  const queued = new Set<string>();
  for (const page of saved) {
    if (page.depth >= maxDepth) continue;
    const nextDepth = page.depth + 1;
    for (const link of [...page.internalLinks, ...page.externalLinks]) {
      const url = normalizeUrl(link.href) || link.href;
      if (!url || seen.has(url) || queued.has(url)) continue;
      if (!isInScope(startUrl, url, scope) || shouldSkipUrl(url)) continue;
      queued.add(url);
      out.push({ url, depth: nextDepth });
      if (out.length >= 8000) return out;
    }
  }
  return out;
}

async function seedQueue(
  meta: JobMeta,
  requestQueue: RequestQueue,
  startUrl: string,
  maxPages: number,
  scope: CrawlScope,
  skip: Set<string>,
  extraSeeds: { url: string; depth: number }[],
  pagesCrawled: number,
): Promise<number> {
  const queued = new Set<string>();
  const enqueue = async (url: string, depth: number) => {
    const key = normalizeUrl(url) || url;
    if (!key || skip.has(key) || queued.has(key)) return;
    if (!isInScope(startUrl, key, scope) || shouldSkipUrl(key)) return;
    queued.add(key);
    await requestQueue.addRequest({
      url: key,
      userData: { depth } satisfies UserData,
    });
  };

  await enqueue(startUrl, 0);
  for (const seed of extraSeeds) {
    await enqueue(seed.url, seed.depth);
  }

  if (!meta.input.features.sitemapSeed) {
    (meta as JobMeta & { _seedCount?: number })._seedCount = 0;
    return 0;
  }

  await updateJob(meta.id, {
    progress: {
      pagesCrawled,
      pagesEnqueued: pagesCrawled + queued.size,
      message: "Fetching sitemap.xml seeds…",
    },
  });

  const seeds = await fetchSitemapSeedUrls(startUrl, scope, maxPages);
  let added = 0;
  for (const url of seeds) {
    const before = queued.size;
    await enqueue(url, 0);
    if (queued.size > before) added += 1;
  }
  (meta as JobMeta & { _seedCount?: number })._seedCount = added;
  return added;
}

async function runCheerioCrawl(
  meta: JobMeta,
  startUrl: string,
  maxPages: number,
  maxDepth: number,
  scope: CrawlScope,
  recordPage: (
    url: string,
    html: string,
    depth: number,
    extra?: {
      statusCode?: number;
      contentType?: string;
      finalUrl?: string;
      screenshotPng?: Buffer;
    },
  ) => Promise<void>,
  pages: PageStructure[],
  seen: Set<string>,
  extraSeeds: { url: string; depth: number }[],
  requestBudget: number,
) {
  const config = crawleeConfig();
  const requestQueue = await RequestQueue.open(`job-${meta.id}-q`, { config });
  const seedCount = await seedQueue(
    meta,
    requestQueue,
    startUrl,
    maxPages,
    scope,
    seen,
    extraSeeds,
    pages.length,
  );
  if (seedCount) {
    await updateJob(meta.id, {
      progress: {
        pagesCrawled: pages.length,
        pagesEnqueued: Math.max(pages.length, seedCount),
        message: `Sitemap seeds +${seedCount}`,
      },
    });
  }

  const crawler = new CheerioCrawler(
    {
      requestQueue,
      maxRequestsPerCrawl: requestBudget,
      maxConcurrency: concurrencyOf(meta, 5),
      requestHandlerTimeoutSecs: 60,
      async requestHandler({ request, body, response }) {
        await politePause(meta);
        const depth = (request.userData as UserData).depth ?? 0;
        const html = typeof body === "string" ? body : body.toString("utf8");
        const url = request.loadedUrl || request.url;

        if (!isInScope(startUrl, url, scope)) return;
        if (shouldSkipUrl(url)) return;

        await recordPage(url, html, depth, {
          statusCode: response?.statusCode,
          contentType: response?.headers?.["content-type"],
          finalUrl: request.loadedUrl,
        });

        if (depth >= maxDepth || pages.length >= maxPages) return;

        const links = collectEnqueueUrls(meta, html, url, startUrl, scope, depth)
          .filter((href) => {
            const key = normalizeUrl(href) || href;
            return !seen.has(key) && isInScope(startUrl, href, scope) && !shouldSkipUrl(href);
          })
          .slice(0, 120);

        for (const href of links) {
          await requestQueue.addRequest(
            {
              url: href,
              userData: { depth: depth + 1 } satisfies UserData,
            },
            { forefront: false },
          );
        }
      },
      async failedRequestHandler({ request }, error) {
        console.error("Request failed", request.url, error);
      },
    },
    config,
  );

  await crawler.run();
}

async function runPlaywrightCrawl(
  meta: JobMeta,
  startUrl: string,
  maxPages: number,
  maxDepth: number,
  scope: CrawlScope,
  recordPage: (
    url: string,
    html: string,
    depth: number,
    extra?: {
      statusCode?: number;
      contentType?: string;
      finalUrl?: string;
      screenshotPng?: Buffer;
    },
  ) => Promise<void>,
  pages: PageStructure[],
  seen: Set<string>,
  extraSeeds: { url: string; depth: number }[],
  requestBudget: number,
) {
  const config = crawleeConfig();
  const requestQueue = await RequestQueue.open(`job-${meta.id}-pw`, { config });
  const seedCount = await seedQueue(
    meta,
    requestQueue,
    startUrl,
    maxPages,
    scope,
    seen,
    extraSeeds,
    pages.length,
  );
  if (seedCount) {
    await updateJob(meta.id, {
      progress: {
        pagesCrawled: pages.length,
        pagesEnqueued: Math.max(pages.length, seedCount),
        message: `Sitemap seeds +${seedCount}`,
      },
    });
  }

  const wantShot = !!meta.input.features.screenshot;

  const crawler = new PlaywrightCrawler(
    {
      requestQueue,
      maxRequestsPerCrawl: requestBudget,
      maxConcurrency: concurrencyOf(meta, 2),
      requestHandlerTimeoutSecs: 90,
      headless: true,
      launchContext: {
        launchOptions: {
          headless: true,
        },
      },
      async requestHandler({ request, page }) {
        await politePause(meta);
        const depth = (request.userData as UserData).depth ?? 0;
        const url = request.loadedUrl || request.url;
        if (!isInScope(startUrl, url, scope)) return;
        if (shouldSkipUrl(url)) return;

        try {
          await page.waitForLoadState("domcontentloaded", { timeout: 30000 });
          await page.waitForTimeout(meta.input.features.polite ? 400 : 800);
        } catch {
          /* continue */
        }

        const html = await page.content();
        const finalUrl = page.url();

        if (!isInScope(startUrl, finalUrl, scope)) return;

        let screenshotPng: Buffer | undefined;
        if (wantShot) {
          try {
            screenshotPng = await page.screenshot({ fullPage: true, type: "png" });
          } catch (err) {
            console.error("inline screenshot failed", finalUrl, err);
          }
        }

        await recordPage(finalUrl || url, html, depth, {
          statusCode: 200,
          contentType: "text/html",
          finalUrl,
          screenshotPng,
        });

        if (depth >= maxDepth || pages.length >= maxPages) return;

        const links = collectEnqueueUrls(
          meta,
          html,
          finalUrl || url,
          startUrl,
          scope,
          depth,
        )
          .filter((href) => {
            const key = normalizeUrl(href) || href;
            return !seen.has(key) && isInScope(startUrl, href, scope) && !shouldSkipUrl(href);
          })
          .slice(0, 100);

        for (const href of links) {
          await requestQueue.addRequest(
            {
              url: href,
              userData: {
                depth: depth + 1,
                isDetail: /intro\.php|cid=/.test(href),
              } satisfies UserData,
            },
            { forefront: /intro\.php|cid=/.test(href) },
          );
        }
      },
      async failedRequestHandler({ request }, error) {
        console.error("Playwright request failed", request.url, error);
      },
    },
    config,
  );

  await crawler.run();
}
