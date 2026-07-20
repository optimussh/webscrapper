const SKIP_EXTENSIONS = new Set([
  ".pdf",
  ".zip",
  ".rar",
  ".7z",
  ".gz",
  ".tar",
  ".png",
  ".jpg",
  ".jpeg",
  ".gif",
  ".webp",
  ".svg",
  ".ico",
  ".mp3",
  ".mp4",
  ".avi",
  ".mov",
  ".wmv",
  ".css",
  ".js",
  ".mjs",
  ".map",
  ".woff",
  ".woff2",
  ".ttf",
  ".eot",
  ".xml",
  ".json",
  ".rss",
  ".atom",
]);

export function normalizeUrl(href: string, base?: string): string | null {
  try {
    const u = base ? new URL(href, base) : new URL(href);
    if (!["http:", "https:"].includes(u.protocol)) return null;
    u.hash = "";
    // Drop common tracking params lightly
    ["utm_source", "utm_medium", "utm_campaign", "utm_term", "utm_content", "fbclid", "gclid"].forEach(
      (k) => u.searchParams.delete(k),
    );
    // Normalize trailing slash for non-root paths with no query: keep as-is from URL API
    return u.toString();
  } catch {
    return null;
  }
}

export function sameOrigin(a: string, b: string): boolean {
  try {
    const ua = new URL(a);
    const ub = new URL(b);
    return ua.origin === ub.origin;
  } catch {
    return false;
  }
}

export function shouldSkipUrl(url: string): boolean {
  try {
    const u = new URL(url);
    const pathname = u.pathname.toLowerCase();
    const ext = pathExtension(pathname);
    if (ext && SKIP_EXTENSIONS.has(ext)) return true;
    if (pathname.includes("/cdn-cgi/")) return true;
    return false;
  } catch {
    return true;
  }
}

function pathExtension(pathname: string): string | null {
  const base = pathname.split("/").pop() ?? "";
  const i = base.lastIndexOf(".");
  if (i <= 0) return null;
  return base.slice(i);
}

export function linkDepth(startUrl: string, targetUrl: string): number {
  try {
    const start = new URL(startUrl);
    const target = new URL(targetUrl);
    const startParts = start.pathname.split("/").filter(Boolean);
    const targetParts = target.pathname.split("/").filter(Boolean);
    // Approximate depth as path segment count delta from root of crawl
    return Math.max(0, targetParts.length - Math.min(startParts.length, 0));
  } catch {
    return 0;
  }
}

export function pathDepth(url: string): number {
  try {
    return new URL(url).pathname.split("/").filter(Boolean).length;
  } catch {
    return 0;
  }
}
