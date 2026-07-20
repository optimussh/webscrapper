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

export async function saveHtml(
  jobId: string,
  pageUrl: string,
  html: string,
): Promise<string> {
  const fileName = urlToSafeFileName(pageUrl);
  const rel = path.join("html", fileName);
  await fs.writeFile(path.join(jobDir(jobId), rel), html, "utf8");
  return rel;
}

export function urlToSafeFileName(pageUrl: string): string {
  const u = new URL(pageUrl);
  let base = `${u.hostname}${u.pathname}`;
  if (u.search) base += `_${Buffer.from(u.search).toString("base64url").slice(0, 24)}`;
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
