# Webscrapper

특정 URL을 입력하면 **같은 사이트(same-origin / site-scope)** 안의 메뉴·하위 페이지·상세 페이지를 따라가며, **참고 사이트 벤치마크 재료**를 모으는 로컬 웹 도구입니다.

새 프로젝트 IA·UX·카피 참고용으로 쓰는 **범용 스크래퍼**입니다. 엔진은 **Crawlee를 유지**하고, Firecrawl / Scrapling / Browser Use 식 능력은 **메뉴·산출물로만 흡수**합니다 (외부 SaaS API 교체 없음).

Repo: https://github.com/optimussh/webscrapper

## 작업 모드

| 모드 | 설명 | 벤치 아이디어 |
|------|------|----------------|
| **B** 구조·사이트맵·시그널 | 제목, 헤딩, 네비, 폼, 프레임워크/분석/결제 시그널 | Crawlee + 자체 |
| **C** CSS 추출 | 사용자 CSS 선택자 → JSON | — |
| **A** HTML 아카이브 | 페이지 HTML 스냅샷 | — |
| **E** Markdown 정제 | 본문 위주 `.md` (nav/footer 제거) | Firecrawl |
| **N** 스크린샷 | full-page PNG + 갤러리 index | 시각 벤치 |
| **G** 스마트 추출 | title/price/cta/sections 휴리스틱 | Scrapling (light) |
| **D** sitemap 시드 | `/sitemap.xml` URL 시드 | Firecrawl-ish |
| **J** 완만 크롤 | 낮은 동시성 + 요청 간 delay | Crawlee polite |
| 결제 UI 캡처 | 결제 화면만 (결제 실행 안 함) | 특수 레시피 |
| 레시피 | 매 job `benchmark-recipe.json` | Browser Use (no LLM) |

**의도적 미구현:** CAPTCHA/안티봇 우회, 프록시 로테이션 UI, Firecrawl 클라우드 호출, 완전 자율 LLM 브라우저.

## 사이트 유형

| 유형 | 엔진 | 용도 |
|------|------|------|
| 1. `static` 단순 HTML | Cheerio (Crawlee) | 회사 홈, 블로그, 문서 |
| 2. `dynamic` 동적/SPA | Playwright | React/Next 등 JS 렌더 |
| 3. `list-detail` 목록→상세 | Playwright | 쇼핑몰, 게시판 |

## 요구 사항

- Node.js 20+
- (유형 2·3, 스크린샷, 결제 캡처) Playwright Chromium  
  `npx playwright install chromium`

## 설치 & 실행

```bash
npm install
npx playwright install chromium
npm run dev
```

브라우저에서 **http://localhost:5900** 을 엽니다.

### 작업 후 확인 (배포 정책)

이 앱은 **로컬 도구**입니다 (파일시스템 job 저장 · Playwright · 장시간 크롤).  
Vercel 같은 서버리스에는 그대로 올리지 않습니다.

| 단계 | 내용 |
|------|------|
| 1 | `git commit` + `git push` → https://github.com/optimussh/webscrapper |
| 2 | `npm run dev` → **http://localhost:5900** (확인용 “배포”) |
| 3 | 네트워크 접근: http://192.168.x.x:5900 (같은 LAN) |

서버가 꺼져 있으면 브라우저에 **Failed to load page** / 연결 거부가 납니다. 코드 오류가 아니라 **dev 서버 미기동**인 경우가 많습니다.

## 사용 흐름

1. **범용 벤치 프리셋** 또는 URL 직접 입력  
2. 사이트 유형 1 / 2 / 3  
3. 작업 모드 체크 (기본: B+A+E+N+G+D+J)  
4. (C) CSS 필드 / (3) 목록·상세 선택자  
5. **크롤 시작** → 진행 화면 → **ZIP 다운로드**

### 예: 운세의 신 (목록 → 상세)

UI **「운세의 신(짝사랑 목록) 프리셋」** 또는:

| 설정 | 값 |
|------|-----|
| 사이트 유형 | `3. 목록 → 상세` |
| 범위 | `site` |
| 목록 링크 | `.free-cont a` |
| 상세 URL | `intro.php?cid=` |

```bash
npx tsx scripts/smoke-unsin.ts
```

### 결제 화면 캡처

상품 상세마다 결제 UI만 열고 **결제 완료는 하지 않음**.

```
payment/
  payment.json
  index.html
  html/*.pay.html
  screenshots/*.pay.png
```

```bash
npx tsx scripts/smoke-payment.ts
```

## ZIP 구성

```
summary.json
sitemap.json
pages.json          # structure + signals + md/shot paths
extract.json        # C / G
meta.json
benchmark-recipe.json
html/*.html         # A
markdown/*.md       # E
markdown/index.md
screenshots/*.png   # N
screenshots/index.html
payment/            # optional
```

## API

### `POST /api/jobs`

```json
{
  "startUrl": "https://example.com",
  "siteType": "dynamic",
  "features": {
    "structure": true,
    "extract": false,
    "archive": true,
    "markdown": true,
    "screenshot": true,
    "polite": true,
    "sitemapSeed": true,
    "smartExtract": true,
    "paymentCapture": false
  },
  "limits": { "maxPages": 30, "maxDepth": 2, "requestDelayMs": 800, "maxConcurrency": 1 }
}
```

### `GET /api/jobs/:jobId` · `GET /api/jobs/:jobId/zip`

## 설계 문서

- `docs/superpowers/specs/2026-07-21-webscrapper-design.md`
- `docs/superpowers/specs/2026-08-09-oss-feature-bench.md` — OSS 기능 벤치 전략

## 주의

- 동일 registrable site / origin 범위만 수집합니다.  
- `maxPages` 상한 200, `maxDepth` 상한 6.  
- 로그인·CAPTCHA·의도적 우회는 지원하지 않습니다.  
- 대상 사이트 이용약관과 robots.txt를 지키세요.  
- **완만 크롤(J)** 을 기본 프리셋에 켜 두었습니다.

## 스택

- Next.js (App Router) + TypeScript  
- [Crawlee](https://crawlee.dev) (CheerioCrawler / PlaywrightCrawler)  
- Cheerio, Playwright, JSZip  
