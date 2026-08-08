export type SiteType = "static" | "dynamic" | "list-detail";

/**
 * Work-mode flags. Capabilities are inspired by OSS tools (Firecrawl, Scrapling,
 * Crawlee, Browser Use) but implemented in-house on top of Crawlee — no vendor swap.
 */
export type FeatureFlags = {
  /** B — sitemap, headings, links, forms, page signals */
  structure: boolean;
  /** C — CSS selector extractors → extract.json */
  extract: boolean;
  /** A — raw HTML snapshots under html/ */
  archive: boolean;
  /**
   * Capture payment UI (e.g. buycash/result) for every product detail URL.
   * Stops before actual payment. Uses Playwright form POST.
   */
  paymentCapture?: boolean;
  /**
   * E (Firecrawl-inspired) — clean Markdown body per page under markdown/
   */
  markdown?: boolean;
  /**
   * N — full-page screenshots under screenshots/ (Playwright)
   */
  screenshot?: boolean;
  /**
   * J (Crawlee-inspired) — low concurrency + delay between requests
   */
  polite?: boolean;
  /**
   * D — seed queue from /sitemap.xml (and common variants) when present
   */
  sitemapSeed?: boolean;
  /**
   * G (Scrapling adaptive idea, light) — heuristic field extractors when
   * user CSS extractors are empty or as extras for title/price/cta/headings
   */
  smartExtract?: boolean;
};

export type Extractor = {
  name: string;
  selector: string;
  /** text (default), href, src, or any attribute name */
  attr?: string;
  multiple?: boolean;
};

export type JobLimits = {
  maxPages: number;
  maxDepth: number;
  /** Min delay between requests when polite (ms). Default 800. */
  requestDelayMs?: number;
  /** Max concurrent requests when polite. Default 1. */
  maxConcurrency?: number;
};

/** origin = exact host; site = related subdomains (www + fortun.unsin.co.kr) */
export type CrawlScope = "origin" | "site";

export type CreateJobInput = {
  startUrl: string;
  siteType: SiteType;
  features: FeatureFlags;
  extractors?: Extractor[];
  limits?: Partial<JobLimits>;
  /** CSS selector for links on list pages (mode list-detail) */
  listLinkSelector?: string;
  /** Substring(s) that detail URLs should include */
  detailUrlIncludes?: string[];
  /**
   * When set, extractors run inside each matching card/row (list pages).
   * Example for unsin.co.kr: ".free-cont"
   */
  listItemSelector?: string;
  /** Default "site" so fortun.unsin.co.kr is reachable from www.unsin.co.kr */
  scope?: CrawlScope;
};

export type JobStatus = "queued" | "running" | "completed" | "failed";

export type JobMeta = {
  id: string;
  createdAt: string;
  updatedAt: string;
  status: JobStatus;
  error?: string;
  input: Required<
    Pick<CreateJobInput, "startUrl" | "siteType" | "features">
  > & {
    extractors: Extractor[];
    limits: JobLimits;
    listLinkSelector?: string;
    detailUrlIncludes: string[];
    listItemSelector?: string;
    scope: CrawlScope;
  };
  progress: {
    pagesCrawled: number;
    pagesEnqueued: number;
    currentUrl?: string;
    message?: string;
  };
};

export type PageLink = {
  href: string;
  text: string;
  external: boolean;
};

/** Lightweight stack / SEO hints for reference-site benchmarking */
export type PageSignals = {
  lang?: string;
  canonical?: string;
  ogTitle?: string;
  ogDescription?: string;
  ogImage?: string;
  generator?: string;
  /** Detected front-end / platform hints from script src and meta */
  frameworks: string[];
  /** Analytics / tag-manager hints */
  analytics: string[];
  /** Notable third-party hosts (payment, CDN, chat) */
  thirdParties: string[];
};

export type PageStructure = {
  url: string;
  finalUrl?: string;
  statusCode?: number;
  title: string;
  description?: string;
  headings: { level: number; text: string }[];
  navLinks: PageLink[];
  internalLinks: PageLink[];
  externalLinks: PageLink[];
  forms: { action: string; method: string; fieldCount: number }[];
  images: number;
  wordCount: number;
  depth: number;
  contentType?: string;
  error?: string;
  /** Present when structure analysis ran */
  signals?: PageSignals;
  markdownFile?: string;
  screenshotFile?: string;
};

export type ExtractedPage = {
  url: string;
  /** Present when extracted from a list card */
  itemIndex?: number;
  data: Record<string, string | string[] | null>;
  /** true when row came from smartExtract heuristics */
  smart?: boolean;
};

export type SitemapNode = {
  url: string;
  title: string;
  children: SitemapNode[];
};

export type JobSummary = {
  id: string;
  startUrl: string;
  siteType: SiteType;
  features: FeatureFlags;
  pagesCrawled: number;
  completedAt: string;
  durationMs: number;
  paymentCaptured?: number;
  paymentFailed?: number;
  markdownCount?: number;
  screenshotCount?: number;
  sitemapSeedCount?: number;
};

/** Reproducible job plan (Browser Use "recipe" idea — thin, no LLM). */
export type BenchmarkRecipe = {
  version: 1;
  createdAt: string;
  note: string;
  input: JobMeta["input"];
};

/** One payment-page benchmark capture (no payment completed). */
export type PaymentCapture = {
  detailUrl: string;
  paymentUrl?: string;
  ok: boolean;
  error?: string;
  productTitle?: string;
  amountHint?: string;
  paymentMethods: string[];
  ctaLabels: string[];
  formFields: { name: string; type: string; label?: string }[];
  notices: string[];
  htmlFile?: string;
  screenshotFile?: string;
  capturedAt: string;
};
