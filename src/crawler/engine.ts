import { CheerioCrawler, Configuration, PlaywrightCrawler, RequestQueue } from "crawlee";
import {
  analyzeHtml,
  buildSitemap,
  discoverLinks,
  discoverListDetailLinks,
  extractFromHtml,
} from "../lib/analyze";
import {
  readJob,
  saveExtract,
  saveHtml,
  savePages,
  saveSitemap,
  saveSummary,
  updateJob,
} from "../lib/jobs";
import type { ExtractedPage, JobMeta, PageStructure } from "../lib/types";
import { normalizeUrl, pathDepth, shouldSkipUrl, sameOrigin } from "../lib/url";

type UserData = {
  depth: number;
  isDetail?: boolean;
};

function crawleeConfig() {
  // Avoid writing Apify-style storage into the repo root when possible
  return new Configuration({
    persistStorage: false,
    purgeOnStart: true,
  });
}

export async function runCrawlJob(jobId: string): Promise<void> {
  const meta = await readJob(jobId);
  if (!meta) throw new Error(`Job not found: ${jobId}`);

  const started = Date.now();
  await updateJob(jobId, {
    status: "running",
    progress: { message: "Starting crawl", pagesCrawled: 0, pagesEnqueued: 1 },
  });

  const pages: PageStructure[] = [];
  const extracts: ExtractedPage[] = [];
  const seen = new Set<string>();
  const { input } = meta;
  const startUrl = normalizeUrl(input.startUrl) || input.startUrl;
  const maxPages = input.limits.maxPages;
  const maxDepth = input.limits.maxDepth;

  const recordPage = async (
    url: string,
    html: string,
    depth: number,
    extra?: { statusCode?: number; contentType?: string; finalUrl?: string },
  ) => {
    if (pages.length >= maxPages) return;
    if (seen.has(url)) return;
    seen.add(url);

    if (input.features.structure || true) {
      pages.push(
        analyzeHtml(html, url, depth, {
          statusCode: extra?.statusCode,
          contentType: extra?.contentType,
          finalUrl: extra?.finalUrl,
        }),
      );
    }

    if (input.features.extract && input.extractors.length) {
      extracts.push({
        url,
        data: extractFromHtml(html, url, input.extractors),
      });
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

    // Incremental save for UI polling
    await savePages(jobId, pages);
    if (input.features.extract) await saveExtract(jobId, extracts);
  };

  try {
    if (input.siteType === "static") {
      await runCheerioCrawl(meta, startUrl, maxPages, maxDepth, recordPage, pages);
    } else {
      await runPlaywrightCrawl(meta, startUrl, maxPages, maxDepth, recordPage, pages);
    }

    const sitemap = buildSitemap(pages, startUrl);
    await saveSitemap(jobId, sitemap);
    await savePages(jobId, pages);
    if (input.features.extract) await saveExtract(jobId, extracts);

    await saveSummary(jobId, {
      id: jobId,
      startUrl,
      siteType: input.siteType,
      features: input.features,
      pagesCrawled: pages.length,
      completedAt: new Date().toISOString(),
      durationMs: Date.now() - started,
    });

    await updateJob(jobId, {
      status: "completed",
      progress: {
        pagesCrawled: pages.length,
        pagesEnqueued: seen.size,
        message: `Done — ${pages.length} pages`,
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
    // Still persist whatever we got
    if (pages.length) {
      await savePages(jobId, pages);
      await saveSitemap(jobId, buildSitemap(pages, startUrl));
    }
    throw err;
  }
}

async function runCheerioCrawl(
  meta: JobMeta,
  startUrl: string,
  maxPages: number,
  maxDepth: number,
  recordPage: (
    url: string,
    html: string,
    depth: number,
    extra?: { statusCode?: number; contentType?: string; finalUrl?: string },
  ) => Promise<void>,
  pages: PageStructure[],
) {
  const config = crawleeConfig();
  const requestQueue = await RequestQueue.open(`job-${meta.id}-q`, { config });
  await requestQueue.addRequest({
    url: startUrl,
    userData: { depth: 0 } satisfies UserData,
  });

  const crawler = new CheerioCrawler(
    {
      requestQueue,
      maxRequestsPerCrawl: maxPages,
      maxConcurrency: 5,
      requestHandlerTimeoutSecs: 60,
      async requestHandler({ request, body, response, enqueueLinks }) {
        const depth = (request.userData as UserData).depth ?? 0;
        const html = typeof body === "string" ? body : body.toString("utf8");
        const url = request.loadedUrl || request.url;

        if (!sameOrigin(startUrl, url)) return;
        if (shouldSkipUrl(url)) return;

        await recordPage(url, html, depth, {
          statusCode: response?.statusCode,
          contentType: response?.headers?.["content-type"],
          finalUrl: request.loadedUrl,
        });

        if (depth >= maxDepth || pages.length >= maxPages) return;

        const links =
          meta.input.siteType === "list-detail"
            ? discoverListDetailLinks(
                html,
                url,
                meta.input.listLinkSelector,
                meta.input.detailUrlIncludes,
              )
            : discoverLinks(html, url);

        const toEnqueue = links
          .filter((href) => sameOrigin(startUrl, href) && !shouldSkipUrl(href))
          .slice(0, 100)
          .map((href) => ({
            url: href,
            userData: { depth: depth + 1 } satisfies UserData,
          }));

        if (toEnqueue.length) {
          await enqueueLinks({
            urls: toEnqueue.map((t) => t.url),
            userData: { depth: depth + 1 },
            strategy: "same-origin",
          });
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
  recordPage: (
    url: string,
    html: string,
    depth: number,
    extra?: { statusCode?: number; contentType?: string; finalUrl?: string },
  ) => Promise<void>,
  pages: PageStructure[],
) {
  const config = crawleeConfig();
  const requestQueue = await RequestQueue.open(`job-${meta.id}-pw`, { config });
  await requestQueue.addRequest({
    url: startUrl,
    userData: { depth: 0 } satisfies UserData,
  });

  const isListDetail = meta.input.siteType === "list-detail";

  const crawler = new PlaywrightCrawler(
    {
      requestQueue,
      maxRequestsPerCrawl: maxPages,
      maxConcurrency: 2,
      requestHandlerTimeoutSecs: 90,
      headless: true,
      launchContext: {
        launchOptions: {
          headless: true,
        },
      },
      async requestHandler({ request, page, enqueueLinks }) {
        const depth = (request.userData as UserData).depth ?? 0;
        const url = request.loadedUrl || request.url;
        if (!sameOrigin(startUrl, url)) return;
        if (shouldSkipUrl(url)) return;

        // SPA: wait for network to settle a bit
        try {
          await page.waitForLoadState("domcontentloaded", { timeout: 30000 });
          await page.waitForTimeout(500);
        } catch {
          /* continue with whatever we have */
        }

        const html = await page.content();
        const finalUrl = page.url();

        await recordPage(finalUrl || url, html, depth, {
          statusCode: 200,
          contentType: "text/html",
          finalUrl,
        });

        if (depth >= maxDepth || pages.length >= maxPages) return;

        let urls: string[];
        if (isListDetail && depth === 0) {
          urls = discoverListDetailLinks(
            html,
            finalUrl || url,
            meta.input.listLinkSelector,
            meta.input.detailUrlIncludes,
          );
        } else if (isListDetail) {
          // From detail pages, still discover shallow same-origin links sparingly
          urls = discoverLinks(html, finalUrl || url).filter(
            (u) => pathDepth(u) <= pathDepth(startUrl) + maxDepth,
          );
        } else {
          urls = discoverLinks(html, finalUrl || url);
        }

        const filtered = urls
          .filter((href) => sameOrigin(startUrl, href) && !shouldSkipUrl(href))
          .slice(0, 80);

        if (filtered.length) {
          await enqueueLinks({
            urls: filtered,
            userData: {
              depth: depth + 1,
              isDetail: isListDetail && depth === 0,
            } satisfies UserData,
            strategy: "same-origin",
          });
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
