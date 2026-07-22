export type SiteType = "static" | "dynamic" | "list-detail";

export type FeatureFlags = {
  structure: boolean; // B
  extract: boolean; // C
  archive: boolean; // A
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
};

export type ExtractedPage = {
  url: string;
  /** Present when extracted from a list card */
  itemIndex?: number;
  data: Record<string, string | string[] | null>;
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
};
