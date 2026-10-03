import { isInScope, normalizeUrl, shouldSkipUrl } from "./url";
import type { CrawlScope } from "./types";

/**
 * Firecrawl-inspired seed expansion: pull URLs from sitemap.xml when available.
 * Best-effort; failures are ignored so crawl still starts from startUrl.
 */
const MAX_SITEMAP_DOCS = 50;

export async function fetchSitemapSeedUrls(
  startUrl: string,
  scope: CrawlScope,
  maxUrls: number,
): Promise<string[]> {
  const pages: string[] = [];
  const seenPages = new Set<string>();
  const seenDocs = new Set<string>();
  const queue = candidateSitemapUrls(startUrl);

  while (queue.length && pages.length < maxUrls && seenDocs.size < MAX_SITEMAP_DOCS) {
    const smUrl = queue.shift()!;
    const docKey = normalizeUrl(smUrl) || smUrl;
    if (seenDocs.has(docKey)) continue;
    seenDocs.add(docKey);

    let text = "";
    try {
      const res = await fetch(smUrl, {
        headers: {
          "User-Agent": "WebscrapperBenchmark/1.0 (+local; respectful crawler)",
          Accept: "application/xml,text/xml,*/*",
        },
        signal: AbortSignal.timeout(12000),
      });
      if (!res.ok) continue;
      text = await res.text();
    } catch {
      continue;
    }
    if (!text.includes("<url") && !text.includes("<sitemap")) continue;

    const locs = [...text.matchAll(/<loc>\s*([^<]+)\s*<\/loc>/gi)].map((match) =>
      match[1].trim(),
    );
    if (/<sitemapindex/i.test(text)) {
      for (const loc of locs) {
        const child = normalizeUrl(loc, smUrl) || loc;
        if (!seenDocs.has(child)) queue.push(child);
      }
      continue;
    }

    for (const loc of locs) {
      if (pages.length >= maxUrls) break;
      const abs = normalizeUrl(loc, startUrl) || loc;
      if (seenPages.has(abs)) continue;
      if (!isInScope(startUrl, abs, scope) || shouldSkipUrl(abs)) continue;
      seenPages.add(abs);
      pages.push(abs);
    }
  }

  return pages;
}

function candidateSitemapUrls(startUrl: string): string[] {
  try {
    const u = new URL(startUrl);
    const origin = u.origin;
    return [
      `${origin}/sitemap.xml`,
      `${origin}/sitemap_index.xml`,
      `${origin}/sitemap-index.xml`,
      `${origin}/wp-sitemap.xml`,
    ];
  } catch {
    return [];
  }
}
