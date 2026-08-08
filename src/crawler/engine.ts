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
import {
  readJob,
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
import { htmlToMarkdown } from "../lib/markdown";
import { mergeExtractors } from "../lib/smart-extract";
import { fetchSitemapSeedUrls } from "../lib/sitemap-seed";
import type { CrawlScope, ExtractedPage, JobMeta, PageStructure } from "../lib/types";
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
  await updateJob(jobId, {
    status: "running",
    progress: { message: "Starting crawl", pagesCrawled: 0, pagesEnqueued: 1 },
  });

  // Always save reproducible plan (thin "recipe" — Browser Use idea without LLM)
  await saveBenchmarkRecipe(jobId, meta.input);

  const pages: PageStructure[] = [];
  const extracts: ExtractedPage[] = [];
  const mdEntries: { url: string; title?: string; file: string }[] = [];
  const shotEntries: { url: string; title?: string; file: string }[] = [];
  const seen = new Set<string>();
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

  try {
    if (input.siteType === "static") {
      await runCheerioCrawl(meta, startUrl, maxPages, maxDepth, scope, recordPage, pages);
    } else {
      await runPlaywrightCrawl(meta, startUrl, maxPages, maxDepth, scope, recordPage, pages);
    }

    // Static crawls cannot screenshot in-handler — second pass with Playwright
    if (input.features.screenshot && input.siteType === "static" && pages.length) {
      await updateJob(jobId, {
        progress: {
          pagesCrawled: pages.length,
          pagesEnqueued: seen.size,
          message: `Screenshots 0/${pages.length}`,
        },
      });
      await screenshotUrls(jobId, pages, (done, total, url) => {
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

    if (mdEntries.length) await saveMarkdownIndex(jobId, mdEntries);
    if (shotEntries.length) await saveScreenshotIndex(jobId, shotEntries);

    let paymentOk = 0;
    let paymentFail = 0;
    if (input.features.paymentCapture) {
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
      markdownCount: mdEntries.length,
      screenshotCount: shotEntries.length,
      sitemapSeedCount,
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
    }
    throw err;
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

async function seedQueue(
  meta: JobMeta,
  requestQueue: RequestQueue,
  startUrl: string,
  maxPages: number,
  scope: CrawlScope,
): Promise<number> {
  await requestQueue.addRequest({
    url: startUrl,
    userData: { depth: 0 } satisfies UserData,
  });

  if (!meta.input.features.sitemapSeed) return 0;

  await updateJob(meta.id, {
    progress: {
      pagesCrawled: 0,
      pagesEnqueued: 1,
      message: "Fetching sitemap.xml seeds…",
    },
  });

  const seeds = await fetchSitemapSeedUrls(startUrl, scope, Math.min(maxPages, 80));
  let added = 0;
  for (const url of seeds) {
    if (url === startUrl) continue;
    await requestQueue.addRequest(
      {
        url,
        userData: { depth: 0 } satisfies UserData,
      },
      { forefront: false },
    );
    added += 1;
  }
  // stash for summary
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
) {
  const config = crawleeConfig();
  const requestQueue = await RequestQueue.open(`job-${meta.id}-q`, { config });
  const seedCount = await seedQueue(meta, requestQueue, startUrl, maxPages, scope);
  if (seedCount) {
    await updateJob(meta.id, {
      progress: {
        pagesCrawled: 0,
        pagesEnqueued: seedCount + 1,
        message: `Sitemap seeds +${seedCount}`,
      },
    });
  }

  const crawler = new CheerioCrawler(
    {
      requestQueue,
      maxRequestsPerCrawl: maxPages,
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
          .filter((href) => isInScope(startUrl, href, scope) && !shouldSkipUrl(href))
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
) {
  const config = crawleeConfig();
  const requestQueue = await RequestQueue.open(`job-${meta.id}-pw`, { config });
  const seedCount = await seedQueue(meta, requestQueue, startUrl, maxPages, scope);
  if (seedCount) {
    await updateJob(meta.id, {
      progress: {
        pagesCrawled: 0,
        pagesEnqueued: seedCount + 1,
        message: `Sitemap seeds +${seedCount}`,
      },
    });
  }

  const wantShot = !!meta.input.features.screenshot;

  const crawler = new PlaywrightCrawler(
    {
      requestQueue,
      maxRequestsPerCrawl: maxPages,
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
          .filter((href) => isInScope(startUrl, href, scope) && !shouldSkipUrl(href))
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
