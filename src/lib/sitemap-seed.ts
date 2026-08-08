import { isInScope, normalizeUrl, shouldSkipUrl } from "./url";
import type { CrawlScope } from "./types";

/**
 * Firecrawl-inspired seed expansion: pull URLs from sitemap.xml when available.
 * Best-effort; failures are ignored so crawl still starts from startUrl.
 */
export async function fetchSitemapSeedUrls(
  startUrl: string,
  scope: CrawlScope,
  maxUrls: number,
): Promise<string[]> {
  const origins = candidateSitemapUrls(startUrl);
  const found: string[] = [];
  const seen = new Set<string>();

  for (const smUrl of origins) {
    if (found.length >= maxUrls) break;
    try {
      const res = await fetch(smUrl, {
        headers: {
          "User-Agent": "WebscrapperBenchmark/1.0 (+local; respectful crawler)",
          Accept: "application/xml,text/xml,*/*",
        },
        signal: AbortSignal.timeout(12000),
      });
      if (!res.ok) continue;
      const text = await res.text();
      if (!text.includes("<url") && !text.includes("<sitemap")) continue;

      // sitemap index → nested sitemaps
      const nested = [...text.matchAll(/<loc>\s*([^<]+)\s*<\/loc>/gi)].map((m) =>
        m[1].trim(),
      );
      const isIndex = /<sitemapindex/i.test(text);

      if (isIndex) {
        for (const child of nested.slice(0, 5)) {
          if (found.length >= maxUrls) break;
          const childUrls = await fetchSitemapSeedUrls(child, scope, maxUrls - found.length);
          for (const u of childUrls) {
            if (seen.has(u)) continue;
            if (!isInScope(startUrl, u, scope) || shouldSkipUrl(u)) continue;
            seen.add(u);
            found.push(u);
          }
        }
      } else {
        for (const loc of nested) {
          if (found.length >= maxUrls) break;
          const abs = normalizeUrl(loc, startUrl) || loc;
          if (seen.has(abs)) continue;
          if (!isInScope(startUrl, abs, scope) || shouldSkipUrl(abs)) continue;
          seen.add(abs);
          found.push(abs);
        }
      }
    } catch {
      /* try next candidate */
    }
  }

  return found;
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
