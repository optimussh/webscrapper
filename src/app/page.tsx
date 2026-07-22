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

const UNSIN_PRESET = {
  startUrl: "https://www.unsin.co.kr/unse/fortun/submain/result?ca2=37",
  siteType: "list-detail" as SiteType,
  structure: true,
  extract: true,
  archive: true,
  paymentCapture: true,
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
  const [startUrl, setStartUrl] = useState(UNSIN_PRESET.startUrl);
  const [siteType, setSiteType] = useState<SiteType>("list-detail");
  const [structure, setStructure] = useState(true);
  const [extract, setExtract] = useState(true);
  const [archive, setArchive] = useState(true);
  const [paymentCapture, setPaymentCapture] = useState(true);
  const [maxPages, setMaxPages] = useState(25);
  const [maxDepth, setMaxDepth] = useState(2);
  const [scope, setScope] = useState<CrawlScope>("site");
  const [listLinkSelector, setListLinkSelector] = useState(".free-cont a");
  const [detailUrlIncludes, setDetailUrlIncludes] = useState("intro.php?cid=");
  const [listItemSelector, setListItemSelector] = useState("");
  const [extractorRows, setExtractorRows] = useState<ExtractorRow[]>(UNSIN_PRESET.extractorRows);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const showListDetail = siteType === "list-detail";

  const canSubmit = useMemo(
    () =>
      startUrl.trim().length > 0 &&
      (structure || extract || archive || paymentCapture) &&
      !busy,
    [startUrl, structure, extract, archive, paymentCapture, busy],
  );

  function applyUnsinPreset() {
    setStartUrl(UNSIN_PRESET.startUrl);
    setSiteType(UNSIN_PRESET.siteType);
    setStructure(UNSIN_PRESET.structure);
    setExtract(UNSIN_PRESET.extract);
    setArchive(UNSIN_PRESET.archive);
    setPaymentCapture(UNSIN_PRESET.paymentCapture);
    setMaxPages(UNSIN_PRESET.maxPages);
    setMaxDepth(UNSIN_PRESET.maxDepth);
    setScope(UNSIN_PRESET.scope);
    setListLinkSelector(UNSIN_PRESET.listLinkSelector);
    setDetailUrlIncludes(UNSIN_PRESET.detailUrlIncludes);
    setListItemSelector(UNSIN_PRESET.listItemSelector);
    setExtractorRows(UNSIN_PRESET.extractorRows);
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
          features: { structure, extract, archive, paymentCapture },
          extractors,
          limits: { maxPages, maxDepth },
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
        <h1>사이트 전체를 지도처럼 읽고, 데이터로 뽑기</h1>
        <p>
          예: 운세의 신 홈/목록 → 상품 카드 클릭 →{" "}
          <code>fortun.unsin.co.kr/intro.php?cid=…</code> 상세(소개·태그·구성)까지
          같은 사이트로 보고 따라갑니다. 관련 서브도메인은 기본 허용입니다.
        </p>
      </div>

      <form className="card" onSubmit={onSubmit}>
        <div className="btn-row" style={{ marginBottom: 14 }}>
          <button type="button" className="btn secondary" onClick={applyUnsinPreset}>
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
            placeholder="https://www.unsin.co.kr/unse/fortun/submain/result?ca2=37"
          />
        </label>
        <p className="hint">
          홈만 넣어도 됩니다. 다만 페이지 수/깊이를 넉넉히 주세요 (예: 페이지 50, 깊이 3).
          상세만 빠르게 보려면 목록 URL부터 시작하는 걸 추천합니다.
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
            <small>메뉴/목록 후 상세(다른 서브도메인 포함).</small>
          </label>
        </div>

        <div style={{ marginBottom: 4 }}>
          <span style={{ fontSize: 13, fontWeight: 600, color: "#cbd5e1" }}>
            작업 모드
          </span>
        </div>
        <div className="checks">
          <label>
            <input
              type="checkbox"
              checked={structure}
              onChange={(e) => setStructure(e.target.checked)}
            />
            B. 구조·사이트맵
          </label>
          <label>
            <input
              type="checkbox"
              checked={extract}
              onChange={(e) => setExtract(e.target.checked)}
            />
            C. 데이터 추출
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
              checked={paymentCapture}
              onChange={(e) => setPaymentCapture(e.target.checked)}
            />
            결제 화면 캡처 (상세 URL 전체, 결제 실행 안 함)
          </label>
        </div>
        {paymentCapture && (
          <p className="hint">
            수집된 상품 상세(<code>intro.php?cid=…</code>)마다 결제 UI(
            <code>buycash/result</code>)를 열어 HTML·스크린샷·결제수단/폼 구조를 저장합니다.
            카드 결제 완료는 하지 않습니다. 상세가 많으면 시간이 꽤 걸립니다.
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
            <span>최대 깊이 (홈→목록→상세 = 2~3)</span>
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
            <option value="site">site — 관련 서브도메인 포함 (추천, fortun.unsin.co.kr OK)</option>
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
                placeholder=".free-cont a"
              />
            </label>
            <p className="hint">운세의 신 상품 카드: <code>.free-cont a</code></p>
            <label className="field">
              <span>상세 URL에 포함될 문자열</span>
              <input
                type="text"
                value={detailUrlIncludes}
                onChange={(e) => setDetailUrlIncludes(e.target.value)}
                placeholder="intro.php?cid="
              />
            </label>
            <label className="field">
              <span>목록 카드 선택자 (목록 페이지에서 행 단위 추출할 때만)</span>
              <input
                type="text"
                value={listItemSelector}
                onChange={(e) => setListItemSelector(e.target.value)}
                placeholder="비우면 페이지 단위 추출 (상세 페이지용)"
              />
            </label>
          </>
        )}

        {extract && (
          <div style={{ marginTop: 8 }}>
            <div style={{ fontSize: 13, fontWeight: 600, color: "#cbd5e1", marginBottom: 8 }}>
              추출 필드 (상세 페이지 CSS 선택자)
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
