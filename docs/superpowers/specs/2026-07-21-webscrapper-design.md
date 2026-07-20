# Webscrapper Design

**Date:** 2026-07-21  
**Repo:** https://github.com/optimussh/webscrapper  
**Stack:** Node.js + TypeScript + Next.js + Crawlee (Cheerio / Playwright)

## Goal

URL을 입력하면 선택한 사이트 유형에 맞게 크롤링하고, 페이지 구조 분석(B)·데이터 추출(C)·선택적 아카이브(A) 결과를 페이지별로 보여 주며 ZIP으로 내려받는 웹 도구.

## Site type modes

| Mode | Label | Engine | Behavior |
|------|--------|--------|----------|
| `static` | 1. 단순 HTML | CheerioCrawler | HTTP fetch + HTML parse (fast) |
| `dynamic` | 2. 동적/SPA | PlaywrightCrawler | Headless browser, wait for DOM |
| `list-detail` | 3. 목록→상세 | PlaywrightCrawler | Seed list pages, enqueue detail links matching patterns |

## Work modes (features)

| Flag | Name | Output |
|------|------|--------|
| B | Structure | Sitemap tree, per-page title/headings/links/forms, nav candidates |
| C | Extract | User-defined CSS selectors → JSON/CSV rows per page |
| A | Archive | Raw HTML (and later assets) per page |

MVP ships A+B+C; A stores HTML snapshots. Asset mirroring can extend later.

## Architecture

```
Browser UI (Next.js App Router)
    │ POST /api/jobs  { url, siteType, features, extractors, limits }
    ▼
Job store (filesystem: data/jobs/<id>/)
    │ spawn / await crawl runner
    ▼
Crawlee runner (src/crawler)
    │ enqueue same-origin links, respect maxPages/maxDepth
    ▼
Results: pages.json, sitemap.json, extract.json, html/, summary.json
    │
    ▼ GET /api/jobs/:id  status + results
      GET /api/jobs/:id/zip  ZIP of job folder
```

### Components

1. **UI** — form (URL, site type, features, extractors, limits), job progress, result tree, download ZIP  
2. **API** — create job, poll status, download ZIP  
3. **Job store** — JSON metadata + result files under `data/jobs/`  
4. **Crawler** — mode-specific crawler, shared analyzers (structure, extract, archive)

## Crawl rules

- Same registrable origin only (block external hosts)  
- Default `maxPages`: 50, `maxDepth`: 3 (user configurable, hard cap 200 / 6)  
- Normalize URLs (strip hash, optional trailing slash)  
- Skip common binary extensions (pdf, zip, images) for structure crawl; optional later  
- `list-detail`: user can supply `listLinkSelector` and/or `detailUrlIncludes` patterns; if empty, heuristics from nav + same-path depth  

## Extractors (mode C)

Array of `{ name, selector, attr?: "text"|"href"|"src"|attribute name, multiple?: boolean }`.

## ZIP layout

```
job-<id>.zip
  summary.json
  sitemap.json
  pages.json
  extract.json          # if C
  html/<safe-path>.html # if A
```

## Non-goals (v1)

- Multi-user auth / SaaS billing  
- Login-walled sites / CAPTCHA bypass  
- Distributed crawl workers  
- Full offline asset mirror (CSS/JS rewrite) — HTML snapshot only for A

## Implementation order

1. Scaffold Next.js + deps  
2. Job store + API  
3. Crawler modes + B structure  
4. C extract + A HTML  
5. UI + ZIP  
6. README + push to GitHub  

## Success criteria

- User can pick type 1/2/3, run crawl, see per-page structure  
- Optional extractors produce JSON  
- ZIP downloads successfully  
- Commits on `main` at https://github.com/optimussh/webscrapper  
