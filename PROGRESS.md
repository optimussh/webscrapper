# PROGRESS — webscrapper

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
