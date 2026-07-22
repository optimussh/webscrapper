import { CheerioCrawler, Configuration, PlaywrightCrawler, RequestQueue } from "crawlee";
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
  saveExtract,
  saveHtml,
  savePages,
  saveSitemap,
  saveSummary,
  updateJob,
} from "../lib/jobs";
import type { CrawlScope, ExtractedPage, JobMeta, PageStructure } from "../lib/types";
import { isInScope, normalizeUrl, shouldSkipUrl } from "../lib/url";

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
  const scope = scopeOf(meta);

  const recordPage = async (
    url: string,
    html: string,
    depth: number,
    extra?: { statusCode?: number; contentType?: string; finalUrl?: string },
  ) => {
    if (pages.length >= maxPages) return;
    // Normalize key so trailing-slash variants don't double-count
    const key = normalizeUrl(url) || url;
    if (seen.has(key)) return;
    seen.add(key);

    pages.push(
      analyzeHtml(html, url, depth, {
        statusCode: extra?.statusCode,
        contentType: extra?.contentType,
        finalUrl: extra?.finalUrl,
      }),
    );

    if (input.features.extract && input.extractors.length) {
      if (input.listItemSelector) {
        const rows = extractListItems(
          html,
          url,
          input.listItemSelector,
          input.extractors,
        );
        if (rows.length) {
          extracts.push(...rows);
        } else {
          // Detail pages often have no list cards — fall back to page-level extract
          extracts.push({
            url,
            data: extractFromHtml(html, url, input.extractors),
          });
        }
      } else {
        extracts.push({
          url,
          data: extractFromHtml(html, url, input.extractors),
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
    if (input.features.extract) await saveExtract(jobId, extracts);
  };

  try {
    if (input.siteType === "static") {
      await runCheerioCrawl(meta, startUrl, maxPages, maxDepth, scope, recordPage, pages);
    } else {
      await runPlaywrightCrawl(meta, startUrl, maxPages, maxDepth, scope, recordPage, pages);
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
    if (pages.length) {
      await savePages(jobId, pages);
      await saveSitemap(jobId, buildSitemap(pages, startUrl));
    }
    throw err;
  }
}

function collectEnqueueUrls(
  meta: JobMeta,
  html: string,
  pageUrl: string,
  startUrl: string,
  scope: CrawlScope,
  depth: number,
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
      async requestHandler({ request, body, response }) {
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
      async requestHandler({ request, page }) {
        const depth = (request.userData as UserData).depth ?? 0;
        const url = request.loadedUrl || request.url;
        if (!isInScope(startUrl, url, scope)) return;
        if (shouldSkipUrl(url)) return;

        try {
          await page.waitForLoadState("domcontentloaded", { timeout: 30000 });
          await page.waitForTimeout(800);
        } catch {
          /* continue */
        }

        const html = await page.content();
        const finalUrl = page.url();

        if (!isInScope(startUrl, finalUrl, scope)) return;

        await recordPage(finalUrl || url, html, depth, {
          statusCode: 200,
          contentType: "text/html",
          finalUrl,
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
