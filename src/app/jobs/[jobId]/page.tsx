"use client";

import { useEffect, useMemo, useState } from "react";
import { useParams } from "next/navigation";
import type {
  ExtractedPage,
  JobMeta,
  JobSummary,
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
  }, [jobId]);

  const pages = data?.pages ?? [];
  const meta = data?.meta;
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
          </p>
          <div className="btn-row">
            <a className="btn" href={`/api/jobs/${jobId}/zip`}>
              ZIP 다운로드
            </a>
            <a className="btn secondary" href="/">
              새 작업
            </a>
          </div>
        </div>
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
            </div>
          )}
        </>
      )}

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
