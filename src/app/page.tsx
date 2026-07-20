"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import type { Extractor, SiteType } from "../lib/types";

type ExtractorRow = {
  name: string;
  selector: string;
  attr: string;
  multiple: boolean;
};

export default function HomePage() {
  const router = useRouter();
  const [startUrl, setStartUrl] = useState("https://example.com");
  const [siteType, setSiteType] = useState<SiteType>("static");
  const [structure, setStructure] = useState(true);
  const [extract, setExtract] = useState(false);
  const [archive, setArchive] = useState(true);
  const [maxPages, setMaxPages] = useState(30);
  const [maxDepth, setMaxDepth] = useState(2);
  const [listLinkSelector, setListLinkSelector] = useState("");
  const [detailUrlIncludes, setDetailUrlIncludes] = useState("");
  const [extractorRows, setExtractorRows] = useState<ExtractorRow[]>([
    { name: "title", selector: "h1", attr: "text", multiple: false },
  ]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const showListDetail = siteType === "list-detail";

  const canSubmit = useMemo(
    () => startUrl.trim().length > 0 && (structure || extract || archive) && !busy,
    [startUrl, structure, extract, archive, busy],
  );

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
          features: { structure, extract, archive },
          extractors,
          limits: { maxPages, maxDepth },
          listLinkSelector: listLinkSelector.trim() || undefined,
          detailUrlIncludes: detailUrlIncludes
            .split(",")
            .map((s) => s.trim())
            .filter(Boolean),
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
          사이트 유형(단순 HTML / 동적 SPA / 목록→상세)을 고르면 메뉴·하위 페이지·상세까지
          따라가며 <strong>구조 분석(B)</strong>, <strong>필드 추출(C)</strong>,{" "}
          <strong>HTML 저장(A)</strong> 결과를 만들고 ZIP으로 받을 수 있습니다.
        </p>
      </div>

      <form className="card" onSubmit={onSubmit}>
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
            <small>빠른 HTTP 크롤 (Cheerio). 블로그·회사 사이트.</small>
          </label>
          <label>
            <input
              type="radio"
              name="siteType"
              checked={siteType === "dynamic"}
              onChange={() => setSiteType("dynamic")}
            />
            <strong>2. 동적 / SPA</strong>
            <small>브라우저 렌더 (Playwright). React/Next 등.</small>
          </label>
          <label>
            <input
              type="radio"
              name="siteType"
              checked={siteType === "list-detail"}
              onChange={() => setSiteType("list-detail")}
            />
            <strong>3. 목록 → 상세</strong>
            <small>쇼핑몰·게시판. 목록에서 상세 링크 수집.</small>
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
        </div>

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

        {showListDetail && (
          <>
            <label className="field">
              <span>목록 링크 CSS 선택자 (선택)</span>
              <input
                type="text"
                value={listLinkSelector}
                onChange={(e) => setListLinkSelector(e.target.value)}
                placeholder="예: .product-card a, a.item-link"
              />
            </label>
            <p className="hint">비우면 main/article/card/li 링크 휴리스틱을 사용합니다.</p>
            <label className="field">
              <span>상세 URL에 포함될 문자열 (쉼표 구분, 선택)</span>
              <input
                type="text"
                value={detailUrlIncludes}
                onChange={(e) => setDetailUrlIncludes(e.target.value)}
                placeholder="예: /product/, /item/, /posts/"
              />
            </label>
          </>
        )}

        {extract && (
          <div style={{ marginTop: 8 }}>
            <div style={{ fontSize: 13, fontWeight: 600, color: "#cbd5e1", marginBottom: 8 }}>
              추출 필드 (CSS 선택자)
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
