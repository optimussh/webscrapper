import * as cheerio from "cheerio";

/**
 * Firecrawl-inspired clean Markdown: strip chrome, keep readable body.
 * No external MD library — stable, dependency-light conversion for benchmarks.
 */
export function htmlToMarkdown(html: string, pageUrl: string): string {
  const $ = cheerio.load(html);

  $("script, style, noscript, iframe, svg, canvas").remove();
  $(
    "nav, header, footer, aside, [role='navigation'], [role='banner'], [role='contentinfo']",
  ).remove();
  $(
    ".cookie, .cookies, #cookie, .popup, .modal, .advertisement, .ads, .ad, .share, .social, .breadcrumb",
  ).remove();

  const title =
    clean($("title").first().text()) ||
    clean($("h1").first().text()) ||
    pageUrl;
  const description =
    $('meta[name="description"]').attr("content")?.trim() ||
    $('meta[property="og:description"]').attr("content")?.trim() ||
    "";

  let root = $("main, article, [role='main'], .content, #content, .post, .entry").first();
  if (!root.length) root = $("body");

  const lines: string[] = [];
  lines.push(`# ${title}`);
  lines.push("");
  lines.push(`> Source: ${pageUrl}`);
  if (description) {
    lines.push("");
    lines.push(description);
  }
  lines.push("");
  lines.push("---");
  lines.push("");

  walk(root, $, lines, 0);

  return lines
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim()
    .concat("\n");
}

function clean(s: string): string {
  return s.replace(/\s+/g, " ").trim();
}

function walk(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  node: cheerio.Cheerio<any>,
  $: cheerio.CheerioAPI,
  lines: string[],
  listDepth: number,
): void {
  node.contents().each((_, el) => {
    // Text node
    if (el.type === "text") {
      const t = clean((el as unknown as { data?: string }).data || "");
      if (t) lines.push(t);
      return;
    }
    if (el.type !== "tag") return;

    const tag = (el.tagName || "").toLowerCase();
    const $el = $(el);

    if (["script", "style", "noscript"].includes(tag)) return;

    if (/^h[1-6]$/.test(tag)) {
      const level = Number(tag[1]) || 1;
      const text = clean($el.text());
      if (text) {
        lines.push("");
        lines.push(`${"#".repeat(Math.min(level + 1, 6))} ${text}`);
        lines.push("");
      }
      return;
    }

    if (tag === "p") {
      const text = clean($el.text());
      if (text) {
        lines.push(text);
        lines.push("");
      }
      return;
    }

    if (tag === "br") {
      lines.push("");
      return;
    }

    if (tag === "hr") {
      lines.push("");
      lines.push("---");
      lines.push("");
      return;
    }

    if (tag === "a") {
      const text = clean($el.text());
      const href = $el.attr("href") || "";
      if (text && href && !href.startsWith("#") && !href.startsWith("javascript:")) {
        lines.push(`[${text}](${href})`);
      } else if (text) {
        lines.push(text);
      }
      return;
    }

    if (tag === "img") {
      const alt = clean($el.attr("alt") || "image");
      const src = $el.attr("src") || "";
      if (src) lines.push(`![${alt}](${src})`);
      return;
    }

    if (tag === "li") {
      const text = clean($el.text());
      if (text) lines.push(`${"  ".repeat(listDepth)}- ${text}`);
      return;
    }

    if (tag === "ul" || tag === "ol") {
      lines.push("");
      $el.children("li").each((__, li) => {
        const text = clean($(li).text());
        if (text) lines.push(`${"  ".repeat(listDepth)}- ${text}`);
      });
      lines.push("");
      return;
    }

    if (tag === "blockquote") {
      const text = clean($el.text());
      if (text) {
        lines.push("");
        for (const part of text.split(/(?<=[.!?])\s+/)) {
          if (part) lines.push(`> ${part}`);
        }
        lines.push("");
      }
      return;
    }

    if (tag === "pre" || tag === "code") {
      const text = $el.text().trim();
      if (text) {
        lines.push("");
        lines.push("```");
        lines.push(text);
        lines.push("```");
        lines.push("");
      }
      return;
    }

    if (["div", "section", "article", "main", "span", "td", "th", "tr", "table", "body"].includes(tag)) {
      walk($el, $, lines, listDepth);
      if (["div", "section", "article"].includes(tag)) lines.push("");
      return;
    }

    const fallback = clean($el.text());
    if (fallback && fallback.length < 500) lines.push(fallback);
  });
}
