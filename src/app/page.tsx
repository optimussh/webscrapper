"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import type { CrawlScope, Extractor, SiteType } from "../lib/types";

type ExtractorRow = {
  name: string;
  selector: string;
  attr: string;
  multiple: boolean;
};

/** Generic reference-site pack (OSS capability absorption, no vendor APIs). */
const BENCHMARK_PRESET = {
  startUrl: "https://example.com",
  siteType: "dynamic" as SiteType,
  structure: true,
  extract: false,
  archive: true,
  paymentCapture: false,
  markdown: true,
  screenshot: true,
  polite: true,
  sitemapSeed: true,
  smartExtract: true,
  maxPages: 30,
  maxDepth: 2,
  scope: "site" as CrawlScope,
  listLinkSelector: "",
  detailUrlIncludes: "",
  listItemSelector: "",
  extractorRows: [] as ExtractorRow[],
};

const UNSIN_PRESET = {
  startUrl: "https://www.unsin.co.kr/unse/fortun/submain/result?ca2=37",
  siteType: "list-detail" as SiteType,
  structure: true,
  extract: true,
  archive: true,
  paymentCapture: true,
  markdown: true,
  screenshot: false,
  polite: true,
  sitemapSeed: false,
  smartExtract: false,
  maxPages: 25,
  maxDepth: 2,
  scope: "site" as CrawlScope,
  listLinkSelector: ".free-cont a",
  detailUrlIncludes: "intro.php?cid=",
  listItemSelector: "",
  extractorRows: [
    { name: "title", selector: "h2", attr: "text", multiple: false },
    { name: "price", selector: "em.price", attr: "text", multiple: false },
    { name: "sections", selector: "h3", attr: "text", multiple: true },
    { name: "tags", selector: "a[href*='tag'], .tag, .tags a", attr: "text", multiple: true },
  ] as ExtractorRow[],
};

export default function HomePage() {
  const router = useRouter();
  const [startUrl, setStartUrl] = useState(BENCHMARK_PRESET.startUrl);
  const [siteType, setSiteType] = useState<SiteType>("dynamic");
  const [structure, setStructure] = useState(true);
  const [extract, setExtract] = useState(false);
  const [archive, setArchive] = useState(true);
  const [paymentCapture, setPaymentCapture] = useState(false);
  const [markdown, setMarkdown] = useState(true);
  const [screenshot, setScreenshot] = useState(true);
  const [polite, setPolite] = useState(true);
  const [sitemapSeed, setSitemapSeed] = useState(true);
  const [smartExtract, setSmartExtract] = useState(true);
  const [maxPages, setMaxPages] = useState(30);
  const [maxDepth, setMaxDepth] = useState(2);
  const [scope, setScope] = useState<CrawlScope>("site");
  const [listLinkSelector, setListLinkSelector] = useState("");
  const [detailUrlIncludes, setDetailUrlIncludes] = useState("");
  const [listItemSelector, setListItemSelector] = useState("");
  const [extractorRows, setExtractorRows] = useState<ExtractorRow[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const showListDetail = siteType === "list-detail";

  const canSubmit = useMemo(
    () =>
      startUrl.trim().length > 0 &&
      (structure ||
        extract ||
        archive ||
        paymentCapture ||
        markdown ||
        screenshot ||
        smartExtract) &&
      !busy,
    [
      startUrl,
      structure,
      extract,
      archive,
      paymentCapture,
      markdown,
      screenshot,
      smartExtract,
      busy,
    ],
  );

  function applyPreset(p: typeof BENCHMARK_PRESET | typeof UNSIN_PRESET) {
    setStartUrl(p.startUrl);
    setSiteType(p.siteType);
    setStructure(p.structure);
    setExtract(p.extract);
    setArchive(p.archive);
    setPaymentCapture(p.paymentCapture);
    setMarkdown(p.markdown);
    setScreenshot(p.screenshot);
    setPolite(p.polite);
    setSitemapSeed(p.sitemapSeed);
    setSmartExtract(p.smartExtract);
    setMaxPages(p.maxPages);
    setMaxDepth(p.maxDepth);
    setScope(p.scope);
    setListLinkSelector(p.listLinkSelector);
    setDetailUrlIncludes(p.detailUrlIncludes);
    setListItemSelector(p.listItemSelector);
    setExtractorRows(p.extractorRows);
  }

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      const extractors: Extractor[] = extract
        ? extractorRows
            .filter((r) => r.name.trim() && r.selector.trim())
            .map((r) => ({
              name: r.name.trim(),
              selector: r.selector.trim(),
              attr: r.attr || "text",
              multiple: r.multiple,
            }))
        : [];

      const res = await fetch("/api/jobs", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          startUrl: startUrl.trim(),
          siteType,
          features: {
            structure,
            extract,
            archive,
            paymentCapture,
            markdown,
            screenshot,
            polite,
            sitemapSeed,
            smartExtract,
          },
          extractors,
          limits: {
            maxPages,
            maxDepth,
            requestDelayMs: polite ? 800 : 0,
            maxConcurrency: polite ? 1 : siteType === "static" ? 5 : 2,
          },
          scope,
          listLinkSelector: listLinkSelector.trim() || undefined,
          detailUrlIncludes: detailUrlIncludes
            .split(",")
            .map((s) => s.trim())
            .filter(Boolean),
          listItemSelector: listItemSelector.trim() || undefined,
        }),
      });

      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to start job");
      router.push(`/jobs/${data.job.id}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unknown error");
      setBusy(false);
    }
  }

  return (
    <div>
      <div className="hero">
        <h1>참고 사이트를 지도처럼 읽고, 벤치 재료로 뽑기</h1>
        <p>
          범용 로컬 크롤러입니다. Crawlee를 엔진으로 유지하고, Firecrawl·Scrapling·Browser Use 식{" "}
          <strong>능력만</strong> 메뉴로 흡수했습니다 (외부 SaaS/우회/LLM 에이전트 없음).
          새 프로젝트 IA·카피·UX 참고용 ZIP을 만듭니다.
        </p>
      </div>

      <form className="card" onSubmit={onSubmit}>
        <div className="btn-row" style={{ marginBottom: 14 }}>
          <button
            type="button"
            className="btn secondary"
            onClick={() => applyPreset(BENCHMARK_PRESET)}
          >
            범용 벤치 프리셋
          </button>
          <button
            type="button"
            className="btn secondary"
            onClick={() => applyPreset(UNSIN_PRESET)}
          >
            운세의 신(짝사랑 목록) 프리셋
          </button>
        </div>

        <label className="field">
          <span>대상 URL</span>
          <input
            type="url"
            required
            value={startUrl}
            onChange={(e) => setStartUrl(e.target.value)}
            placeholder="https://example.com"
          />
        </label>
        <p className="hint">
          홈·문서·랜딩·스토어 어떤 URL이든 가능합니다. 깊이/페이지 수를 사이트 규모에 맞게 조절하세요.
        </p>

        <div style={{ marginBottom: 8 }}>
          <span style={{ fontSize: 13, fontWeight: 600, color: "#cbd5e1" }}>
            사이트 유형
          </span>
        </div>
        <div className="segmented" style={{ marginBottom: 18 }}>
          <label>
            <input
              type="radio"
              name="siteType"
              checked={siteType === "static"}
              onChange={() => setSiteType("static")}
            />
            <strong>1. 단순 HTML</strong>
            <small>빠른 HTTP 크롤 (Cheerio).</small>
          </label>
          <label>
            <input
              type="radio"
              name="siteType"
              checked={siteType === "dynamic"}
              onChange={() => setSiteType("dynamic")}
            />
            <strong>2. 동적 / SPA</strong>
            <small>브라우저 렌더 (Playwright).</small>
          </label>
          <label>
            <input
              type="radio"
              name="siteType"
              checked={siteType === "list-detail"}
              onChange={() => setSiteType("list-detail")}
            />
            <strong>3. 목록 → 상세</strong>
            <small>메뉴/목록 후 상세(서브도메인 포함).</small>
          </label>
        </div>

        <div style={{ marginBottom: 4 }}>
          <span style={{ fontSize: 13, fontWeight: 600, color: "#cbd5e1" }}>
            작업 모드 (기능 벤치)
          </span>
        </div>
        <div className="checks">
          <label>
            <input
              type="checkbox"
              checked={structure}
              onChange={(e) => setStructure(e.target.checked)}
            />
            B. 구조·사이트맵·시그널
          </label>
          <label>
            <input
              type="checkbox"
              checked={extract}
              onChange={(e) => setExtract(e.target.checked)}
            />
            C. CSS 데이터 추출
          </label>
          <label>
            <input
              type="checkbox"
              checked={archive}
              onChange={(e) => setArchive(e.target.checked)}
            />
            A. HTML 아카이브
          </label>
          <label>
            <input
              type="checkbox"
              checked={markdown}
              onChange={(e) => setMarkdown(e.target.checked)}
            />
            E. Markdown 정제
            <span className="check-tag">Firecrawl</span>
          </label>
          <label>
            <input
              type="checkbox"
              checked={screenshot}
              onChange={(e) => setScreenshot(e.target.checked)}
            />
            N. 페이지 스크린샷
          </label>
          <label>
            <input
              type="checkbox"
              checked={smartExtract}
              onChange={(e) => setSmartExtract(e.target.checked)}
            />
            G. 스마트 추출
            <span className="check-tag">Scrapling</span>
          </label>
          <label>
            <input
              type="checkbox"
              checked={sitemapSeed}
              onChange={(e) => setSitemapSeed(e.target.checked)}
            />
            D. sitemap.xml 시드
          </label>
          <label>
            <input
              type="checkbox"
              checked={polite}
              onChange={(e) => setPolite(e.target.checked)}
            />
            J. 완만 크롤
            <span className="check-tag">Crawlee</span>
          </label>
          <label>
            <input
              type="checkbox"
              checked={paymentCapture}
              onChange={(e) => setPaymentCapture(e.target.checked)}
            />
            결제 화면 캡처 (결제 실행 안 함)
          </label>
        </div>
        <p className="hint">
          매 job마다 <code>benchmark-recipe.json</code> 이 저장됩니다 (재현용 얇은 레시피 · Browser Use 아이디어, LLM 없음).
          CAPTCHA/안티봇 우회·외부 스크랩 SaaS 호출은 지원하지 않습니다.
        </p>
        {paymentCapture && (
          <p className="hint">
            상품 상세(<code>intro.php?cid=…</code>)마다 결제 UI HTML·스크린샷·폼 구조를 저장합니다.
          </p>
        )}
        {screenshot && siteType === "static" && (
          <p className="hint">
            단순 HTML 모드에서도 크롤 후 Playwright로 스크린샷 2차 패스를 돌립니다. 시간이 더 걸립니다.
          </p>
        )}

        <div className="grid-2">
          <label className="field">
            <span>최대 페이지 수</span>
            <input
              type="number"
              min={1}
              max={200}
              value={maxPages}
              onChange={(e) => setMaxPages(Number(e.target.value))}
            />
          </label>
          <label className="field">
            <span>최대 깊이</span>
            <input
              type="number"
              min={0}
              max={6}
              value={maxDepth}
              onChange={(e) => setMaxDepth(Number(e.target.value))}
            />
          </label>
        </div>

        <label className="field">
          <span>크롤 범위</span>
          <select value={scope} onChange={(e) => setScope(e.target.value as CrawlScope)}>
            <option value="site">site — 관련 서브도메인 포함</option>
            <option value="origin">origin — 시작 호스트만</option>
          </select>
        </label>

        {showListDetail && (
          <>
            <label className="field">
              <span>목록 링크 CSS 선택자</span>
              <input
                type="text"
                value={listLinkSelector}
                onChange={(e) => setListLinkSelector(e.target.value)}
                placeholder=".product a"
              />
            </label>
            <label className="field">
              <span>상세 URL에 포함될 문자열 (쉼표 구분)</span>
              <input
                type="text"
                value={detailUrlIncludes}
                onChange={(e) => setDetailUrlIncludes(e.target.value)}
                placeholder="/product/, intro.php?cid="
              />
            </label>
            <label className="field">
              <span>목록 카드 선택자 (행 단위 추출)</span>
              <input
                type="text"
                value={listItemSelector}
                onChange={(e) => setListItemSelector(e.target.value)}
                placeholder="비우면 페이지 단위"
              />
            </label>
          </>
        )}

        {extract && (
          <div style={{ marginTop: 8 }}>
            <div style={{ fontSize: 13, fontWeight: 600, color: "#cbd5e1", marginBottom: 8 }}>
              추출 필드 (CSS) — 스마트 추출과 이름이 겹치면 여기 값이 우선
            </div>
            {extractorRows.map((row, i) => (
              <div className="grid-2" key={i} style={{ marginBottom: 8 }}>
                <label className="field">
                  <span>필드 이름</span>
                  <input
                    value={row.name}
                    onChange={(e) => {
                      const next = [...extractorRows];
                      next[i] = { ...row, name: e.target.value };
                      setExtractorRows(next);
                    }}
                    placeholder="price"
                  />
                </label>
                <label className="field">
                  <span>선택자</span>
                  <input
                    value={row.selector}
                    onChange={(e) => {
                      const next = [...extractorRows];
                      next[i] = { ...row, selector: e.target.value };
                      setExtractorRows(next);
                    }}
                    placeholder=".price"
                  />
                </label>
                <label className="field">
                  <span>속성</span>
                  <select
                    value={row.attr}
                    onChange={(e) => {
                      const next = [...extractorRows];
                      next[i] = { ...row, attr: e.target.value };
                      setExtractorRows(next);
                    }}
                  >
                    <option value="text">text</option>
                    <option value="href">href</option>
                    <option value="src">src</option>
                    <option value="content">content</option>
                    <option value="html">html</option>
                  </select>
                </label>
                <label className="field" style={{ justifyContent: "flex-end" }}>
                  <span>여러 개</span>
                  <div style={{ display: "flex", gap: 10, alignItems: "center", height: 42 }}>
                    <input
                      type="checkbox"
                      checked={row.multiple}
                      onChange={(e) => {
                        const next = [...extractorRows];
                        next[i] = { ...row, multiple: e.target.checked };
                        setExtractorRows(next);
                      }}
                    />
                    <button
                      type="button"
                      className="btn secondary"
                      style={{ padding: "8px 12px", fontSize: 12 }}
                      onClick={() =>
                        setExtractorRows(extractorRows.filter((_, j) => j !== i))
                      }
                    >
                      삭제
                    </button>
                  </div>
                </label>
              </div>
            ))}
            <button
              type="button"
              className="btn secondary"
              onClick={() =>
                setExtractorRows([
                  ...extractorRows,
                  { name: "", selector: "", attr: "text", multiple: false },
                ])
              }
            >
              필드 추가
            </button>
          </div>
        )}

        <div className="btn-row">
          <button className="btn" type="submit" disabled={!canSubmit}>
            {busy ? "시작 중…" : "크롤 시작"}
          </button>
        </div>
        {error && <div className="error-box">{error}</div>}
      </form>
    </div>
  );
}
