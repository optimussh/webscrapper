import * as cheerio from "cheerio";
import type { CrawlScope, Extractor, PageLink, PageStructure } from "./types";
import { isInScope, normalizeUrl, sameOrigin, shouldSkipUrl } from "./url";

function cleanText(s: string): string {
  return s.replace(/\s+/g, " ").trim();
}

function collectLinks(
  $: cheerio.CheerioAPI,
  pageUrl: string,
): { internal: PageLink[]; external: PageLink[]; nav: PageLink[] } {
  const internal: PageLink[] = [];
  const external: PageLink[] = [];
  const seen = new Set<string>();

  $("a[href]").each((_, el) => {
    const hrefRaw = $(el).attr("href");
    if (!hrefRaw) return;
    const abs = normalizeUrl(hrefRaw, pageUrl);
    if (!abs || seen.has(abs)) return;
    seen.add(abs);
    const text = cleanText($(el).text()).slice(0, 200);
    const externalFlag = !sameOrigin(pageUrl, abs);
    const item: PageLink = { href: abs, text, external: externalFlag };
    if (externalFlag) external.push(item);
    else internal.push(item);
  });

  const nav: PageLink[] = [];
  const navSeen = new Set<string>();
  $("nav a[href], header a[href], [role='navigation'] a[href]").each((_, el) => {
    const hrefRaw = $(el).attr("href");
    if (!hrefRaw) return;
    const abs = normalizeUrl(hrefRaw, pageUrl);
    if (!abs || navSeen.has(abs) || !sameOrigin(pageUrl, abs)) return;
    navSeen.add(abs);
    nav.push({
      href: abs,
      text: cleanText($(el).text()).slice(0, 200),
      external: false,
    });
  });

  return { internal, external, nav };
}

export function analyzeHtml(
  html: string,
  pageUrl: string,
  depth: number,
  meta?: { statusCode?: number; contentType?: string; finalUrl?: string; error?: string },
): PageStructure {
  const $ = cheerio.load(html);
  $("script, style, noscript").remove();

  const title = cleanText($("title").first().text()) || cleanText($("h1").first().text());
  const description =
    $('meta[name="description"]').attr("content")?.trim() ||
    $('meta[property="og:description"]').attr("content")?.trim();

  const headings: PageStructure["headings"] = [];
  $("h1, h2, h3, h4, h5, h6").each((_, el) => {
    const tag = el.tagName?.toLowerCase?.() ?? $(el).prop("tagName")?.toLowerCase() ?? "h1";
    const level = Number(tag.replace("h", "")) || 1;
    const text = cleanText($(el).text());
    if (text) headings.push({ level, text: text.slice(0, 300) });
  });

  const { internal, external, nav } = collectLinks($, pageUrl);

  const forms: PageStructure["forms"] = [];
  $("form").each((_, el) => {
    const actionRaw = $(el).attr("action") || pageUrl;
    const action = normalizeUrl(actionRaw, pageUrl) || actionRaw;
    const method = ($(el).attr("method") || "get").toLowerCase();
    const fieldCount = $(el).find("input, select, textarea").length;
    forms.push({ action, method, fieldCount });
  });

  const bodyText = cleanText($("body").text());
  const wordCount = bodyText ? bodyText.split(/\s+/).filter(Boolean).length : 0;
  const images = $("img").length;

  return {
    url: pageUrl,
    finalUrl: meta?.finalUrl,
    statusCode: meta?.statusCode,
    title,
    description,
    headings,
    navLinks: nav,
    internalLinks: internal,
    externalLinks: external,
    forms,
    images,
    wordCount,
    depth,
    contentType: meta?.contentType,
    error: meta?.error,
  };
}

function valueFromNode(
  $: cheerio.CheerioAPI,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  el: any,
  attr: string,
  pageUrl: string,
): string | undefined {
  if (attr === "text") return cleanText($(el).text());
  if (attr === "html") return $(el).html() ?? "";
  const raw = $(el).attr(attr);
  if (raw && (attr === "href" || attr === "src")) {
    return normalizeUrl(raw, pageUrl) || raw;
  }
  return raw?.trim();
}

function extractWithScope(
  $: cheerio.CheerioAPI,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  scope: cheerio.Cheerio<any>,
  pageUrl: string,
  extractors: Extractor[],
): Record<string, string | string[] | null> {
  const data: Record<string, string | string[] | null> = {};
  for (const ex of extractors) {
    if (!ex.name || !ex.selector) continue;
    const nodes = scope.find(ex.selector);
    if (!nodes.length) {
      data[ex.name] = ex.multiple ? [] : null;
      continue;
    }
    const attr = ex.attr || "text";
    const values: string[] = [];
    nodes.each((_, el) => {
      const v = valueFromNode($, el, attr, pageUrl);
      if (v) values.push(v);
    });
    if (ex.multiple) data[ex.name] = values;
    else data[ex.name] = values[0] ?? null;
  }
  return data;
}

export function extractFromHtml(
  html: string,
  pageUrl: string,
  extractors: Extractor[],
): Record<string, string | string[] | null> {
  const $ = cheerio.load(html);
  return extractWithScope($, $.root(), pageUrl, extractors);
}

/** Extract one row per list card (e.g. .free-cont on unsin list pages). */
export function extractListItems(
  html: string,
  pageUrl: string,
  listItemSelector: string,
  extractors: Extractor[],
): import("./types").ExtractedPage[] {
  const $ = cheerio.load(html);
  const rows: import("./types").ExtractedPage[] = [];
  $(listItemSelector).each((index, el) => {
    const data = extractWithScope($, $(el), pageUrl, extractors);
    const link =
      (typeof data.url === "string" && data.url) ||
      normalizeUrl($(el).find("a[href]").first().attr("href") || "", pageUrl) ||
      pageUrl;
    rows.push({ url: link, itemIndex: index, data });
  });
  return rows;
}

export function buildSitemap(
  pages: PageStructure[],
  startUrl: string,
): import("./types").SitemapNode {
  const byUrl = new Map(pages.map((p) => [p.url, p]));
  const childrenMap = new Map<string, Set<string>>();

  for (const page of pages) {
    if (!childrenMap.has(page.url)) childrenMap.set(page.url, new Set());
    for (const link of page.internalLinks) {
      if (!byUrl.has(link.href)) continue;
      childrenMap.get(page.url)!.add(link.href);
    }
  }

  const visiting = new Set<string>();

  function nodeFor(url: string): import("./types").SitemapNode {
    const page = byUrl.get(url);
    const title = page?.title || url;
    if (visiting.has(url)) {
      return { url, title, children: [] };
    }
    visiting.add(url);
    const childUrls = [...(childrenMap.get(url) ?? [])].filter((c) => c !== url);
    // Prefer fewer children in tree: only include links that look like deeper paths
    const startDepth = pathSegs(startUrl);
    const sorted = childUrls
      .filter((c) => pathSegs(c) >= startDepth)
      .sort((a, b) => pathSegs(a) - pathSegs(b) || a.localeCompare(b))
      .slice(0, 40);

    const children = sorted.map((c) => nodeFor(c));
    visiting.delete(url);
    return { url, title, children };
  }

  const root = byUrl.has(startUrl)
    ? startUrl
    : pages[0]?.url || startUrl;

  return nodeFor(root);
}

function pathSegs(url: string): number {
  try {
    return new URL(url).pathname.split("/").filter(Boolean).length;
  } catch {
    return 0;
  }
}

/** Collect in-scope hrefs from HTML for enqueueing */
export function discoverLinks(
  html: string,
  pageUrl: string,
  startUrl?: string,
  scope: CrawlScope = "site",
): string[] {
  const $ = cheerio.load(html);
  const out: string[] = [];
  const seen = new Set<string>();
  const root = startUrl || pageUrl;
  $("a[href]").each((_, el) => {
    const abs = normalizeUrl($(el).attr("href") || "", pageUrl);
    if (!abs || seen.has(abs)) return;
    if (!isInScope(root, abs, scope)) return;
    seen.add(abs);
    out.push(abs);
  });
  return out;
}

/**
 * Discover list + detail links for multi-level catalog sites.
 * Handles cross-subdomain details (www.unsin.co.kr → fortun.unsin.co.kr).
 */
export function discoverListDetailLinks(
  html: string,
  pageUrl: string,
  listLinkSelector?: string,
  detailUrlIncludes?: string[],
  startUrl?: string,
  scope: CrawlScope = "site",
): string[] {
  const $ = cheerio.load(html);
  const seen = new Set<string>();
  const out: string[] = [];
  const root = startUrl || pageUrl;
  const detailPatterns =
    detailUrlIncludes?.length
      ? detailUrlIncludes
      : ["intro.php?cid=", "/intro.php", "fortun."];

  const push = (href: string | undefined) => {
    const abs = normalizeUrl(href || "", pageUrl);
    if (!abs || seen.has(abs)) return;
    if (!isInScope(root, abs, scope)) return;
    if (shouldSkipUrl(abs)) return;
    seen.add(abs);
    out.push(abs);
  };

  const isDetail = (abs: string) => detailPatterns.some((s) => abs.includes(s));

  // 1) Explicit list card selector (e.g. .free-cont a) — prefer these
  if (listLinkSelector) {
    $(listLinkSelector).each((_, el) => {
      const tag = String((el as { tagName?: string }).tagName || "").toLowerCase();
      const href =
        tag === "a"
          ? $(el).attr("href")
          : $(el).find("a[href]").first().attr("href");
      const abs = normalizeUrl(href || "", pageUrl);
      if (!abs) return;
      // If user set detail patterns, keep only matching product links from cards
      if (detailUrlIncludes?.length && !isDetail(abs)) return;
      push(href);
    });
  }

  // 2) Common product-card patterns (unsin .free-cont)
  $(".free-cont a[href], .img-Box a[href]").each((_, el) => {
    const href = $(el).attr("href");
    const abs = normalizeUrl(href || "", pageUrl);
    if (!abs) return;
    if (detailUrlIncludes?.length && !isDetail(abs) && !abs.includes("/unse/free/")) {
      // still allow free fortune same-origin forms
    }
    push(href);
  });

  // 3) Auto detail URLs (always)
  $("a[href*='intro.php'], a[href*='cid=']").each((_, el) => push($(el).attr("href")));

  // 4) Category / list / tab pages (home → menu depth)
  $(
    "a[href*='submain/result'], a[href*='ca2='], a[href*='ca1='], .tablist a[href]",
  ).each((_, el) => push($(el).attr("href")));

  // 5) Fallback
  if (!out.length) {
    $(
      "main a[href], article a[href], .product a[href], .card a[href], li a[href]",
    ).each((_, el) => push($(el).attr("href")));
  }

  if (!out.length) {
    return discoverLinks(html, pageUrl, root, scope);
  }

  // Prefer detail links first in queue order (stable unique already)
  return out.sort((a, b) => Number(isDetail(b)) - Number(isDetail(a)));
}
