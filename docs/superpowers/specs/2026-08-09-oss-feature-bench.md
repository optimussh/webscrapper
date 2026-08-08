# OSS capability absorption (feature-bench, not vendor swap)

**Date:** 2026-08-09  
**Status:** Implemented (P0/P1 thin slice)

## Strategy

Do **not** replace Crawlee with Firecrawl / Scrapling / Browser Use APIs.

| Source idea | Product mapping | Implemented |
|-------------|-----------------|-------------|
| Firecrawl clean MD / structured | **E** `markdown` → `markdown/*.md` | yes |
| Firecrawl seed expansion | **D** `sitemapSeed` from sitemap.xml | yes |
| Scrapling adaptive parse | **G** `smartExtract` heuristic fields | light yes |
| Scrapling pause/proxy/antibot | — | **no** (philosophy: no CAPTCHA bypass) |
| Crawlee E2E + storage | engine + job folder + ZIP | already |
| Crawlee human-like defaults | **J** `polite` delay + concurrency | yes |
| Browser Use agent flows | `benchmark-recipe.json` thin recipe | yes (no LLM) |
| Browser Use / visual QA | **N** `screenshot` full-page PNGs | yes |

## Non-goals (unchanged)

- Calling Firecrawl/Scrapling/Browser Use cloud APIs  
- CAPTCHA / Turnstile / antibot bypass  
- Login-walled scraping  
- Full LLM-driven browser autonomy  

## ZIP additions

```
markdown/*.md
markdown/index.md
screenshots/*.png
screenshots/index.html
benchmark-recipe.json
```

Structure pages also carry `signals` (frameworks, analytics, third-parties, OG).
