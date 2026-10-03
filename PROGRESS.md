# PROGRESS — webscrapper

## 2026-10-03

### Sitemap cycle fix & auto-finalization recovery

- Fixed combinatorial explosion in `buildSitemap` (`src/lib/analyze.ts`) by introducing a global visited set and depth cap (max depth 6, max 30 children/node). Traversal time dropped from infinite/OOM to ~15ms.
- Added `finalizeJob` (`src/crawler/engine.ts`) to reliably generate sitemap, markdown/screenshot indexes, AI brief, and summary from saved pages.
- Added `POST /api/jobs/[jobId]/finalize` endpoint (`src/app/api/jobs/[jobId]/finalize/route.ts`) and a manual "현재 수집본으로 작업 완료" button in UI (`src/app/jobs/[jobId]/page.tsx`).
- Added automatic recovery in `loadJobArtifacts` (`src/lib/jobs.ts`) to auto-finalize jobs if the worker died after completing the target crawl budget.
- Added fallback error handling around `buildSitemap` in crawl engine.


### Reference mirror and AI brief

- One-click capture: public URL, same-site crawl (30 pages / depth 2), GNU wget page-requisites, ZIP.
- Every finished job writes `START-HERE.md`, `ai-brief/GUIDE.md`, and `ai-brief/brief.json`.
- Raw HTML/CSS/images stay reference-only (`reference/mirror`, existing `html/` and screenshots). The guide tells coding agents to rebuild from scratch with OFL/Apache fonts and original copy, and not to paste scraped assets.
- Private and local hosts are rejected before a job starts. wget is used when `wget.exe` is on the machine; otherwise a node page-requisites fallback runs.
- This is an engineering handoff, not legal advice.
- Removed the Unsin preset from the home screen. One-click now sends the page-count and depth fields (default 30 / 2, hard cap 200 / 6).
- Raised the hard cap to 5000 pages and depth 12. Sitemap seeds follow child sitemaps up to that page cap. Home lists past jobs from `data/jobs/<id>`. A running job keeps the limit it started with.
- A finished job can continue from its own page. Raising the cap queues the same job id, keeps saved pages, and fetches only new URLs. An in-flight job still cannot be extended until it finishes or fails.
- A job left `running` after its worker process exits shows the same continue form. Continue stays blocked only while that process is still alive.

## 2026-08-09

### Verify / “deploy”

- Confirmed: no Vercel project; push-only was incomplete for user check.
- `npm run build` OK; started `npm run dev` on **http://localhost:5900** (home 200, POST /api/jobs 201).
- Policy for this repo: push GitHub + leave local :5900 running (not serverless).

### OSS feature-bench (no vendor swap)

- Strategy: keep **Crawlee**; absorb Firecrawl / Scrapling / Browser Use **ideas** as work-mode flags.
- Added features: `markdown`, `screenshot`, `polite`, `sitemapSeed`, `smartExtract`.
- Always write `benchmark-recipe.json` for reproducible runs (thin recipe, no LLM).
- Structure pages now include `signals` (frameworks, analytics, third-parties, OG).
- UI: 범용 벤치 프리셋 + mode checkboxes with source tags; default general-purpose form.
- Docs: `docs/superpowers/specs/2026-08-09-oss-feature-bench.md`, README refresh.
- Out of scope (later): FortuneOne pipeline wiring; pause/resume; adaptive DOM re-bind; antibot bypass (never).
