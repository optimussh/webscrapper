"use client";

import { useEffect, useMemo, useState, type FormEvent } from "react";
import { useParams } from "next/navigation";
import { HARD_MAX_DEPTH, HARD_MAX_PAGES } from "../../../lib/limits";
import type {
  AiBrief,
  ExtractedPage,
  JobMeta,
  JobSummary,
  MirrorReport,
  PageStructure,
  PaymentCapture,
  SitemapNode,
} from "../../../lib/types";

type Artifacts = {
  meta: JobMeta;
  pages?: PageStructure[];
  sitemap?: SitemapNode;
  extract?: ExtractedPage[];
  summary?: JobSummary;
  payment?: PaymentCapture[];
  brief?: AiBrief;
  guide?: string;
  mirror?: MirrorReport;
  storagePath?: string;
};

function renderTree(node: SitemapNode, prefix = ""): string {
  const line = `${prefix}${node.title || node.url}  <${node.url}>\n`;
  const childPrefix = prefix + "  ";
  return (
    line +
    (node.children || []).map((c) => renderTree(c, childPrefix)).join("")
  );
}

export default function JobPage() {
  const params = useParams<{ jobId: string }>();
  const jobId = params.jobId;
  const [data, setData] = useState<Artifacts | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [selectedUrl, setSelectedUrl] = useState<string | null>(null);
  const [watch, setWatch] = useState(0);
  const [seededFor, setSeededFor] = useState<string | null>(null);
  const [nextPages, setNextPages] = useState(HARD_MAX_PAGES);
  const [nextDepth, setNextDepth] = useState(2);
  const [continuing, setContinuing] = useState(false);
  const [loadedFor, setLoadedFor] = useState(jobId);

  if (loadedFor !== jobId) {
    setLoadedFor(jobId);
    setData(null);
    setError(null);
    setSeededFor(null);
    setContinuing(false);
  }

  useEffect(() => {
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout>;

    async function poll() {
      try {
        const res = await fetch(`/api/jobs/${jobId}`, { cache: "no-store" });
        const json = await res.json();
        if (!res.ok) throw new Error(json.error || "Load failed");
        if (!cancelled) {
          setData(json);
          setError(null);
          const status = json.meta?.status as string;
          if (status === "queued" || status === "running") {
            setContinuing(false);
            timer = setTimeout(poll, 1500);
          }
        }
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : "Error");
          timer = setTimeout(poll, 2500);
        }
      }
    }

    void poll();
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [jobId, watch]);

  const pages = data?.pages ?? [];
  const meta = data?.meta;

  useEffect(() => {
    if (!meta || seededFor === jobId) return;
    const crawled = meta.progress.pagesCrawled;
    setNextPages(
      Math.min(
        HARD_MAX_PAGES,
        Math.max(meta.input.limits.maxPages + 300, crawled + 50),
      ),
    );
    setNextDepth(meta.input.limits.maxDepth);
    setSeededFor(jobId);
  }, [meta, jobId, seededFor]);

  async function onContinue(event: FormEvent) {
    event.preventDefault();
    if (!meta) return;
    setContinuing(true);
    setError(null);
    try {
      const res = await fetch(`/api/jobs/${jobId}/continue`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ maxPages: nextPages, maxDepth: nextDepth }),
      });
      const json = (await res.json()) as { error?: string };
      if (!res.ok) throw new Error(json.error || "Continue failed");
      setWatch((n) => n + 1);
    } catch (err) {
      setContinuing(false);
      setError(err instanceof Error ? err.message : "Continue failed");
    }
  }
  const progressPct = useMemo(() => {
    if (!meta) return 0;
    const max = meta.input.limits.maxPages || 1;
    return Math.min(100, Math.round((meta.progress.pagesCrawled / max) * 100));
  }, [meta]);

  const selected = pages.find((p) => p.url === selectedUrl) || pages[0];

  return (
    <div>
      <div className="hero">
        <h1>크롤 결과</h1>
        <p className="meta-line">
          Job <code>{jobId}</code>
        </p>
      </div>

      {error && <div className="error-box">{error}</div>}

      {meta && (
        <div className="card">
          <div style={{ display: "flex", flexWrap: "wrap", gap: 10, alignItems: "center" }}>
            <span className={`status-pill ${meta.status}`}>{meta.status}</span>
            <span className="meta-line" style={{ margin: 0 }}>
              {meta.progress.message}
            </span>
          </div>
          <div className="progress-bar">
            <i style={{ width: `${progressPct}%` }} />
          </div>
          <p className="meta-line">
            대상: <code>{meta.input.startUrl}</code>
            <br />
            유형: <code>{meta.input.siteType}</code> · 페이지{" "}
            {meta.progress.pagesCrawled}/{meta.input.limits.maxPages}
            {meta.progress.currentUrl && (
              <>
                <br />
                현재: <code>{meta.progress.currentUrl}</code>
              </>
            )}
            {meta.error && (
              <>
                <br />
                오류: {meta.error}
              </>
            )}
            {data?.storagePath && (
              <>
                <br />
                저장 위치: <code>{data.storagePath}</code>
              </>
            )}
          </p>
          {(meta.status === "queued" || meta.status === "running" || continuing) && (
            <p className="hint">
              진행 중인 작업의 상한은 도중에 바꿀 수 없습니다. 끝나거나 실패한 뒤 이 화면에서
              저장한 페이지는 그대로 두고 이어서 받을 수 있습니다.
            </p>
          )}
          {(meta.status === "completed" || meta.status === "failed") &&
            !continuing &&
            meta.progress.pagesCrawled >= HARD_MAX_PAGES && (
              <p className="hint">
                이 작업은 페이지 상한 {HARD_MAX_PAGES}에 도달했습니다.
              </p>
            )}
          {(meta.status === "completed" || meta.status === "failed") &&
            !continuing &&
            meta.progress.pagesCrawled < HARD_MAX_PAGES && (
              <form onSubmit={onContinue}>
                <div className="grid-2">
                  <label className="field">
                    <span>이어서 받을 페이지 상한</span>
                    <input
                      type="number"
                      min={meta.progress.pagesCrawled + 1}
                      max={HARD_MAX_PAGES}
                      value={nextPages}
                      onChange={(e) => setNextPages(Number(e.target.value))}
                    />
                  </label>
                  <label className="field">
                    <span>최대 깊이</span>
                    <input
                      type="number"
                      min={0}
                      max={HARD_MAX_DEPTH}
                      value={nextDepth}
                      onChange={(e) => setNextDepth(Number(e.target.value))}
                    />
                  </label>
                </div>
                <p className="hint">
                  이미 저장한 {meta.progress.pagesCrawled}페이지는 다시 받지 않습니다. 그
                  페이지의 링크와 사이트맵에서 새 주소만 이어서 받습니다. 상한은 저장한
                  페이지 수보다 커야 하고, 최대 {HARD_MAX_PAGES}페이지, 깊이 {HARD_MAX_DEPTH}
                  입니다.
                </p>
                <div className="btn-row">
                  <button
                    className="btn"
                    type="submit"
                    disabled={
                      !Number.isFinite(nextPages) ||
                      nextPages <= meta.progress.pagesCrawled ||
                      nextPages > HARD_MAX_PAGES ||
                      !Number.isFinite(nextDepth) ||
                      nextDepth < 0 ||
                      nextDepth > HARD_MAX_DEPTH
                    }
                  >
                    상한을 올려 이어서 크롤
                  </button>
                </div>
              </form>
            )}
          <div className="btn-row">
            <a className="btn" href={`/api/jobs/${jobId}/zip`}>
              ZIP 다운로드
            </a>
            <a className="btn secondary" href="/">
              새 작업
            </a>
          </div>
          <p className="hint">
            ZIP을 열면 <code>START-HERE.md</code> 다음 <code>ai-brief/GUIDE.md</code> 를 코딩 에이전트에
            넘깁니다. <code>reference/</code>, <code>html/</code>, 스크린샷은 섹션 순서를 보는 참고이고
            새 프로젝트에 복사하지 않습니다.
          </p>
        </div>
      )}

      {data?.brief && (
        <>
          <h2 className="section-title">구현 브리프</h2>
          <div className="card">
            <p className="meta-line" style={{ marginTop: 0 }}>
              페이지 {data.brief.pages.length}개
              {data.mirror && (
                <>
                  {" "}
                  · 미러 {data.mirror.engine} · 파일 {data.mirror.files}개
                </>
              )}
            </p>
            <ul>
              {data.brief.pages.slice(0, 12).map((page) => (
                <li key={page.url}>
                  <code>{page.path}</code> — {page.sectionSketch.map((s) => s.kind).join(", ")}
                </li>
              ))}
            </ul>
            {data.mirror?.command && (
              <p className="meta-line">
                wget: <code>{data.mirror.command}</code>
              </p>
            )}
            {data.mirror?.note && <p className="hint">{data.mirror.note}</p>}
          </div>
        </>
      )}

      {data?.guide && (
        <>
          <h2 className="section-title">GUIDE.md</h2>
          <details className="card">
            <summary>가이드 열기</summary>
            <pre className="tree">{data.guide}</pre>
          </details>
        </>
      )}

      {data?.sitemap && (
        <>
          <h2 className="section-title">사이트맵 (B)</h2>
          <div className="tree">{renderTree(data.sitemap)}</div>
        </>
      )}

      {pages.length > 0 && (
        <>
          <h2 className="section-title">페이지 목록 ({pages.length})</h2>
          <div className="table-wrap card" style={{ padding: 0 }}>
            <table>
              <thead>
                <tr>
                  <th>Title</th>
                  <th>URL</th>
                  <th>H</th>
                  <th>Links</th>
                  <th>Words</th>
                </tr>
              </thead>
              <tbody>
                {pages.map((p) => (
                  <tr
                    key={p.url}
                    style={{
                      cursor: "pointer",
                      background:
                        selected?.url === p.url ? "rgba(91,140,255,0.08)" : undefined,
                    }}
                    onClick={() => setSelectedUrl(p.url)}
                  >
                    <td>{p.title || "(no title)"}</td>
                    <td>
                      <code style={{ fontSize: 11 }}>{p.url}</code>
                    </td>
                    <td>{p.headings.length}</td>
                    <td>{p.internalLinks.length}</td>
                    <td>{p.wordCount}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {selected && (
            <div className="page-detail card" style={{ marginTop: 14 }}>
              <h3>{selected.title || selected.url}</h3>
              <p className="meta-line" style={{ marginTop: 0 }}>
                <code>{selected.url}</code>
                {selected.statusCode != null && <> · HTTP {selected.statusCode}</>}
                {selected.description && (
                  <>
                    <br />
                    {selected.description}
                  </>
                )}
              </p>
              <div className="grid-2">
                <div>
                  <strong>Headings</strong>
                  <ul>
                    {selected.headings.slice(0, 12).map((h, i) => (
                      <li key={i}>
                        H{h.level}: {h.text}
                      </li>
                    ))}
                    {!selected.headings.length && <li>(none)</li>}
                  </ul>
                </div>
                <div>
                  <strong>Nav links</strong>
                  <ul>
                    {selected.navLinks.slice(0, 12).map((l, i) => (
                      <li key={i}>
                        {l.text || l.href} — <code style={{ fontSize: 11 }}>{l.href}</code>
                      </li>
                    ))}
                    {!selected.navLinks.length && <li>(none detected)</li>}
                  </ul>
                </div>
              </div>
              <div style={{ marginTop: 10 }}>
                <strong>Forms</strong>
                <ul>
                  {selected.forms.map((f, i) => (
                    <li key={i}>
                      {f.method.toUpperCase()} {f.action} ({f.fieldCount} fields)
                    </li>
                  ))}
                  {!selected.forms.length && <li>(none)</li>}
                </ul>
              </div>
              {selected.signals && (
                <div style={{ marginTop: 12 }}>
                  <strong>Page signals (벤치)</strong>
                  <ul style={{ fontSize: 13 }}>
                    {selected.signals.lang && <li>lang: {selected.signals.lang}</li>}
                    {selected.signals.generator && (
                      <li>generator: {selected.signals.generator}</li>
                    )}
                    {!!selected.signals.frameworks?.length && (
                      <li>frameworks: {selected.signals.frameworks.join(", ")}</li>
                    )}
                    {!!selected.signals.analytics?.length && (
                      <li>analytics: {selected.signals.analytics.join(", ")}</li>
                    )}
                    {!!selected.signals.thirdParties?.length && (
                      <li>third-parties: {selected.signals.thirdParties.join(", ")}</li>
                    )}
                    {selected.signals.ogTitle && (
                      <li>og:title: {selected.signals.ogTitle}</li>
                    )}
                    {selected.markdownFile && (
                      <li>
                        markdown: <code>{selected.markdownFile}</code>
                      </li>
                    )}
                    {selected.screenshotFile && (
                      <li>
                        screenshot: <code>{selected.screenshotFile}</code>
                      </li>
                    )}
                  </ul>
                </div>
              )}
            </div>
          )}
        </>
      )}

      {meta?.input.features.markdown && (
        <>
          <h2 className="section-title">Markdown 정제 (E)</h2>
          <p className="meta-line">
            ZIP 안 <code>markdown/*.md</code>, <code>markdown/index.md</code>
          </p>
        </>
      )}

      {meta?.input.features.screenshot && (
        <>
          <h2 className="section-title">스크린샷 (N)</h2>
          <p className="meta-line">
            ZIP 안 <code>screenshots/*.png</code>, <code>screenshots/index.html</code>
          </p>
        </>
      )}

      <h2 className="section-title">재현 레시피</h2>
      <p className="meta-line">
        매 job에 <code>benchmark-recipe.json</code> 이 포함됩니다. 같은 설정으로 다시 POST 할 때
        참고하세요 (LLM 에이전트 없음).
      </p>

      {data?.extract && data.extract.length > 0 && (
        <>
          <h2 className="section-title">추출 데이터 (C)</h2>
          <div className="table-wrap card" style={{ padding: 0 }}>
            <table>
              <thead>
                <tr>
                  <th>URL</th>
                  <th>Data</th>
                </tr>
              </thead>
              <tbody>
                {data.extract.map((row) => (
                  <tr key={row.url}>
                    <td>
                      <code style={{ fontSize: 11 }}>{row.url}</code>
                    </td>
                    <td>
                      <pre style={{ margin: 0, fontSize: 11, whiteSpace: "pre-wrap" }}>
                        {JSON.stringify(row.data, null, 2)}
                      </pre>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}

      {data?.payment && data.payment.length > 0 && (
        <>
          <h2 className="section-title">
            결제 화면 캡처 ({data.payment.filter((p) => p.ok).length}/
            {data.payment.length} 성공)
          </h2>
          <p className="meta-line">
            ZIP 안 <code>payment/index.html</code>, <code>payment/payment.json</code>,{" "}
            <code>payment/screenshots/</code> 참고. 결제 완료는 하지 않습니다.
          </p>
          <div className="table-wrap card" style={{ padding: 0 }}>
            <table>
              <thead>
                <tr>
                  <th>상태</th>
                  <th>상세 URL</th>
                  <th>금액</th>
                  <th>결제수단</th>
                  <th>CTA</th>
                </tr>
              </thead>
              <tbody>
                {data.payment.map((row) => (
                  <tr key={row.detailUrl}>
                    <td>{row.ok ? "OK" : row.error || "FAIL"}</td>
                    <td>
                      <code style={{ fontSize: 11 }}>{row.detailUrl}</code>
                      {row.paymentUrl && (
                        <>
                          <br />
                          <code style={{ fontSize: 11 }}>{row.paymentUrl}</code>
                        </>
                      )}
                    </td>
                    <td>{row.amountHint || "—"}</td>
                    <td style={{ fontSize: 12 }}>
                      {(row.paymentMethods || []).join(", ") || "—"}
                    </td>
                    <td style={{ fontSize: 12 }}>
                      {(row.ctaLabels || []).join(" / ") || "—"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}

      {data?.summary && (
        <>
          <h2 className="section-title">요약</h2>
          <pre className="tree">{JSON.stringify(data.summary, null, 2)}</pre>
        </>
      )}
    </div>
  );
}
