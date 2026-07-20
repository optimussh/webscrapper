# Webscrapper

특정 URL을 입력하면 **같은 사이트(same-origin)** 안의 메뉴·하위 페이지·상세 페이지를 따라가며:

- **B. 구조·사이트맵 분석** — 제목, 헤딩, 네비/내부 링크, 폼, 페이지 트리  
- **C. 데이터 추출** — CSS 선택자로 필드 추출 (JSON)  
- **A. HTML 아카이브** — 페이지 HTML 스냅샷  

결과를 화면에서 보고 **ZIP**으로 받을 수 있는 로컬 웹 도구입니다.

Repo: https://github.com/optimussh/webscrapper

## 사이트 유형 (선택)

| 유형 | 엔진 | 용도 |
|------|------|------|
| 1. `static` 단순 HTML | Cheerio (Crawlee) | 회사 홈, 블로그, 문서 |
| 2. `dynamic` 동적/SPA | Playwright | React/Next 등 JS 렌더 |
| 3. `list-detail` 목록→상세 | Playwright | 쇼핑몰, 게시판 |

## 요구 사항

- Node.js 20+
- (유형 2·3) Playwright 브라우저 (`npx playwright install chromium`)

## 설치 & 실행

```bash
npm install
npx playwright install chromium
npm run dev
```

브라우저에서 http://localhost:3000 을 엽니다.

## 사용 흐름

1. 대상 URL 입력  
2. 사이트 유형 1 / 2 / 3 선택  
3. 작업 모드 A/B/C 체크  
4. (C) 추출 필드: 이름 + CSS 선택자  
5. (3번 유형) 목록 링크 선택자·상세 URL 패턴(선택)  
6. **크롤 시작** → 진행 화면 → **ZIP 다운로드**

## ZIP 구성

```
summary.json
sitemap.json
pages.json
extract.json   # C 사용 시
meta.json
html/*.html    # A 사용 시
```

## API

### `POST /api/jobs`

```json
{
  "startUrl": "https://example.com",
  "siteType": "static",
  "features": { "structure": true, "extract": false, "archive": true },
  "extractors": [
    { "name": "title", "selector": "h1", "attr": "text", "multiple": false }
  ],
  "limits": { "maxPages": 30, "maxDepth": 2 },
  "listLinkSelector": ".product a",
  "detailUrlIncludes": ["/product/"]
}
```

### `GET /api/jobs/:jobId`

메타 + `pages` / `sitemap` / `extract` / `summary`

### `GET /api/jobs/:jobId/zip`

작업 폴더 전체 ZIP

## 설계 문서

`docs/superpowers/specs/2026-07-21-webscrapper-design.md`

## 주의

- 동일 origin만 수집합니다.  
- `maxPages` 상한 200, `maxDepth` 상한 6.  
- 로그인·CAPTCHA·의도적 우회는 지원하지 않습니다.  
- 대상 사이트 이용약관과 robots.txt를 지키세요.

## 스택

- Next.js (App Router) + TypeScript  
- [Crawlee](https://crawlee.dev) (CheerioCrawler / PlaywrightCrawler)  
- Cheerio, Archiver  
