import * as cheerio from "cheerio";
import type { Extractor, PageLink, PageStructure } from "./types";
import { normalizeUrl, sameOrigin } from "./url";

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

export function extractFromHtml(
  html: string,
  pageUrl: string,
  extractors: Extractor[],
): Record<string, string | string[] | null> {
  const $ = cheerio.load(html);
  const data: Record<string, string | string[] | null> = {};

  for (const ex of extractors) {
    if (!ex.name || !ex.selector) continue;
    const nodes = $(ex.selector);
    if (!nodes.length) {
      data[ex.name] = ex.multiple ? [] : null;
      continue;
    }

    const attr = ex.attr || "text";
    const values: string[] = [];
    nodes.each((_, el) => {
      let v: string | undefined;
      if (attr === "text") v = cleanText($(el).text());
      else if (attr === "html") v = $(el).html() ?? "";
      else {
        const raw = $(el).attr(attr);
        if (raw && (attr === "href" || attr === "src")) {
          v = normalizeUrl(raw, pageUrl) || raw;
        } else {
          v = raw?.trim();
        }
      }
      if (v) values.push(v);
    });

    if (ex.multiple) data[ex.name] = values;
    else data[ex.name] = values[0] ?? null;
  }

  return data;
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

/** Collect same-origin hrefs from HTML for enqueueing */
export function discoverLinks(html: string, pageUrl: string): string[] {
  const $ = cheerio.load(html);
  const out: string[] = [];
  const seen = new Set<string>();
  $("a[href]").each((_, el) => {
    const abs = normalizeUrl($(el).attr("href") || "", pageUrl);
    if (!abs || seen.has(abs)) return;
    if (!sameOrigin(pageUrl, abs)) return;
    seen.add(abs);
    out.push(abs);
  });
  return out;
}

export function discoverListDetailLinks(
  html: string,
  pageUrl: string,
  listLinkSelector?: string,
  detailUrlIncludes?: string[],
): string[] {
  const $ = cheerio.load(html);
  const seen = new Set<string>();
  const out: string[] = [];

  const push = (href: string | undefined) => {
    const abs = normalizeUrl(href || "", pageUrl);
    if (!abs || seen.has(abs) || !sameOrigin(pageUrl, abs)) return;
    if (detailUrlIncludes?.length) {
      const ok = detailUrlIncludes.some((s) => abs.includes(s));
      if (!ok) return;
    }
    seen.add(abs);
    out.push(abs);
  };

  if (listLinkSelector) {
    $(listLinkSelector).each((_, el) => {
      const tag = (el as { tagName?: string }).tagName?.toLowerCase?.();
      if (tag === "a") push($(el).attr("href"));
      else push($(el).find("a[href]").first().attr("href"));
    });
  }

  // Heuristic: main content anchors, cards, list items
  if (!out.length) {
    $(
      "main a[href], article a[href], .product a[href], .card a[href], li a[href], table a[href]",
    ).each((_, el) => push($(el).attr("href")));
  }

  if (!out.length) {
    return discoverLinks(html, pageUrl);
  }

  return out;
}
