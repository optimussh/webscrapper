import fs from "fs/promises";
import path from "path";
import { randomUUID } from "crypto";
import type {
  CreateJobInput,
  ExtractedPage,
  JobLimits,
  JobMeta,
  JobSummary,
  PageStructure,
  SitemapNode,
} from "./types";

const DEFAULT_LIMITS: JobLimits = {
  maxPages: 50,
  maxDepth: 3,
};

const HARD_MAX_PAGES = 200;
const HARD_MAX_DEPTH = 6;

export function getJobsRoot(): string {
  return process.env.JOBS_DIR
    ? path.resolve(process.env.JOBS_DIR)
    : path.join(process.cwd(), "data", "jobs");
}

export function jobDir(jobId: string): string {
  return path.join(getJobsRoot(), jobId);
}

function clampLimits(partial?: Partial<JobLimits>): JobLimits {
  const maxPages = Math.min(
    HARD_MAX_PAGES,
    Math.max(1, partial?.maxPages ?? DEFAULT_LIMITS.maxPages),
  );
  const maxDepth = Math.min(
    HARD_MAX_DEPTH,
    Math.max(0, partial?.maxDepth ?? DEFAULT_LIMITS.maxDepth),
  );
  return { maxPages, maxDepth };
}

export async function ensureJobsRoot(): Promise<void> {
  await fs.mkdir(getJobsRoot(), { recursive: true });
}

export async function createJob(input: CreateJobInput): Promise<JobMeta> {
  await ensureJobsRoot();

  let startUrl: URL;
  try {
    startUrl = new URL(input.startUrl);
  } catch {
    throw new Error("Invalid start URL");
  }
  if (!["http:", "https:"].includes(startUrl.protocol)) {
    throw new Error("URL must be http or https");
  }

  const id = randomUUID();
  const now = new Date().toISOString();
  const features = {
    structure: input.features?.structure ?? true,
    extract: input.features?.extract ?? false,
    archive: input.features?.archive ?? true,
  };

  const meta: JobMeta = {
    id,
    createdAt: now,
    updatedAt: now,
    status: "queued",
    input: {
      startUrl: startUrl.toString(),
      siteType: input.siteType,
      features,
      extractors: input.extractors ?? [],
      limits: clampLimits(input.limits),
      listLinkSelector: input.listLinkSelector,
      detailUrlIncludes: input.detailUrlIncludes ?? [],
      listItemSelector: input.listItemSelector,
      // Default site-scope so related subdomains (www → fortun) are crawlable
      scope: input.scope ?? "site",
    },
    progress: {
      pagesCrawled: 0,
      pagesEnqueued: 0,
      message: "Queued",
    },
  };

  const dir = jobDir(id);
  await fs.mkdir(path.join(dir, "html"), { recursive: true });
  await writeJson(path.join(dir, "meta.json"), meta);
  return meta;
}

export async function readJob(jobId: string): Promise<JobMeta | null> {
  try {
    const raw = await fs.readFile(path.join(jobDir(jobId), "meta.json"), "utf8");
    return JSON.parse(raw) as JobMeta;
  } catch {
    return null;
  }
}

export async function updateJob(
  jobId: string,
  patch: Partial<JobMeta> & {
    progress?: Partial<JobMeta["progress"]>;
  },
): Promise<JobMeta> {
  const current = await readJob(jobId);
  if (!current) throw new Error(`Job not found: ${jobId}`);

  const next: JobMeta = {
    ...current,
    ...patch,
    progress: {
      ...current.progress,
      ...(patch.progress ?? {}),
    },
    updatedAt: new Date().toISOString(),
  };
  await writeJson(path.join(jobDir(jobId), "meta.json"), next);
  return next;
}

export async function writeJson(filePath: string, data: unknown): Promise<void> {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, JSON.stringify(data, null, 2), "utf8");
}

export async function savePages(
  jobId: string,
  pages: PageStructure[],
): Promise<void> {
  await writeJson(path.join(jobDir(jobId), "pages.json"), pages);
}

export async function saveSitemap(
  jobId: string,
  sitemap: SitemapNode,
): Promise<void> {
  await writeJson(path.join(jobDir(jobId), "sitemap.json"), sitemap);
}

export async function saveExtract(
  jobId: string,
  rows: ExtractedPage[],
): Promise<void> {
  await writeJson(path.join(jobDir(jobId), "extract.json"), rows);
}

export async function saveSummary(
  jobId: string,
  summary: JobSummary,
): Promise<void> {
  await writeJson(path.join(jobDir(jobId), "summary.json"), summary);
}

/**
 * Make archived HTML openable offline/online with correct assets:
 * - inject <base href="https://host/"> so relative /css/js/img resolve to origin
 * - rewrite root-relative src/href to absolute
 * - stamp original URL in a visible comment banner
 */
export function prepareArchivedHtml(pageUrl: string, html: string): string {
  let out = html;
  let origin = "";
  let baseHref = "";
  try {
    const u = new URL(pageUrl);
    origin = u.origin;
    // directory of path, e.g. https://fortun.unsin.co.kr/ for /intro.php
    const dir = u.pathname.includes("/")
      ? u.pathname.slice(0, u.pathname.lastIndexOf("/") + 1)
      : "/";
    baseHref = `${u.origin}${dir || "/"}`;
  } catch {
    return html;
  }

  // Rewrite root-relative asset URLs so they don't depend only on <base>
  out = out.replace(
    /(\s(?:href|src|action)=["'])\/(?!\/)/gi,
    `$1${origin}/`,
  );

  const stamp = `<!-- archived-from: ${pageUrl} -->\n`;
  const baseTag = `<base href="${baseHref}">\n`;
  const banner = `<div id="webscrapper-archive-banner" style="position:sticky;top:0;z-index:99999;background:#0f172a;color:#e2e8f0;padding:8px 12px;font:13px/1.4 system-ui,sans-serif;border-bottom:2px solid #38bdf8">아카이브: <a style="color:#7dd3fc" href="${pageUrl}">${pageUrl}</a> · 원본 사이트 레이아웃이 비슷해 보여도 제목/본문은 페이지마다 다릅니다.</div>\n`;

  if (/<head[^>]*>/i.test(out)) {
    out = out.replace(/<head[^>]*>/i, (m) => `${m}\n${stamp}${baseTag}`);
  } else {
    out = `${stamp}${baseTag}${out}`;
  }

  if (/<body[^>]*>/i.test(out)) {
    out = out.replace(/<body[^>]*>/i, (m) => `${m}\n${banner}`);
  }

  return out;
}

export async function saveHtml(
  jobId: string,
  pageUrl: string,
  html: string,
): Promise<string> {
  const fileName = urlToSafeFileName(pageUrl);
  const rel = path.join("html", fileName);
  const prepared = prepareArchivedHtml(pageUrl, html);
  await fs.writeFile(path.join(jobDir(jobId), rel), prepared, "utf8");
  return rel;
}

/** Write html/index.html listing all archived pages (use extract titles when available). */
export async function saveArchiveIndex(
  jobId: string,
  entries: { url: string; title?: string; price?: string }[],
): Promise<void> {
  const rows = entries
    .map((e) => {
      const file = urlToSafeFileName(e.url);
      const label = [e.title, e.price ? `(${e.price})` : "", e.url]
        .filter(Boolean)
        .join(" ");
      return `<li><a href="./${file}">${escapeHtml(label)}</a></li>`;
    })
    .join("\n");

  const html = `<!doctype html>
<html lang="ko">
<head>
  <meta charset="utf-8"/>
  <title>Archive index — ${jobId.slice(0, 8)}</title>
  <style>
    body{font:14px/1.5 system-ui,sans-serif;max-width:900px;margin:24px auto;padding:0 16px;color:#0f172a}
    h1{font-size:1.25rem} li{margin:6px 0} a{color:#0369a1}
    .note{background:#f1f5f9;padding:10px 12px;border-radius:8px;margin-bottom:16px}
  </style>
</head>
<body>
  <h1>아카이브 목록 (${entries.length})</h1>
  <p class="note">각 파일은 서로 다른 페이지입니다. 레이아웃(메뉴/푸터)이 같아 보여도 제목·가격·본문은 다릅니다.
  상단 파란 배너의 URL을 확인하세요. CSS/이미지는 원본 서버에서 불러옵니다(인터넷 필요).</p>
  <ol>
  ${rows}
  </ol>
</body>
</html>`;

  await fs.writeFile(path.join(jobDir(jobId), "html", "index.html"), html, "utf8");
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

export function urlToSafeFileName(pageUrl: string): string {
  const u = new URL(pageUrl);
  let base = `${u.hostname}${u.pathname}`;
  // Keep full query (cid=…) — do not truncate; collisions were rare but titles differ either way
  if (u.search) {
    const q = u.search.replace(/^\?/, "").replace(/[^a-zA-Z0-9._=-]+/g, "_");
    base += `_${q.slice(0, 80)}`;
  }
  const safe = base
    .replace(/\/+$/, "")
    .replace(/[^a-zA-Z0-9._-]+/g, "_")
    .replace(/_+/g, "_")
    .slice(0, 180);
  return `${safe || "index"}.html`;
}

export async function loadJobArtifacts(jobId: string): Promise<{
  meta: JobMeta;
  pages?: PageStructure[];
  sitemap?: SitemapNode;
  extract?: ExtractedPage[];
  summary?: JobSummary;
}> {
  const meta = await readJob(jobId);
  if (!meta) throw new Error("Job not found");

  const dir = jobDir(jobId);
  const readOptional = async <T>(name: string): Promise<T | undefined> => {
    try {
      const raw = await fs.readFile(path.join(dir, name), "utf8");
      return JSON.parse(raw) as T;
    } catch {
      return undefined;
    }
  };

  return {
    meta,
    pages: await readOptional<PageStructure[]>("pages.json"),
    sitemap: await readOptional<SitemapNode>("sitemap.json"),
    extract: await readOptional<ExtractedPage[]>("extract.json"),
    summary: await readOptional<JobSummary>("summary.json"),
  };
}
