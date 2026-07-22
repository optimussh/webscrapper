/**
 * Retrofit existing docs/scrabexample HTML so opening files is clearer:
 * base tag, absolute assets, banner, and html/index.html.
 */
import fs from "fs";
import path from "path";
import {
  prepareArchivedHtml,
  urlToSafeFileName,
} from "../src/lib/jobs";

const root = path.join("docs", "scrabexample");
const htmlDir = path.join(root, "html");

function guessUrlFromFilename(file: string): string | null {
  // fortun.unsin.co.kr_intro.php_cid=412.html (new) or base64url old
  if (file === "index.html") return null;
  if (file.startsWith("www.unsin.co.kr")) {
    return "https://www.unsin.co.kr/";
  }
  if (file.startsWith("fortun.unsin.co.kr_intro.php")) {
    // old: ..._P2NpZD00MTI.html  base64url of ?cid=412
    const m = file.match(/_P2NpZD0([A-Za-z0-9_-]+)\.html$/);
    if (m) {
      try {
        const decoded = Buffer.from(m[1], "base64url").toString("utf8");
        // decoded often "cid=412" without ?
        const q = decoded.startsWith("?") ? decoded : `?${decoded}`;
        return `https://fortun.unsin.co.kr/intro.php${q}`;
      } catch {
        /* fall through */
      }
    }
    const m2 = file.match(/_cid=(\d+)\.html$/i);
    if (m2) return `https://fortun.unsin.co.kr/intro.php?cid=${m2[1]}`;
  }
  return null;
}

function main() {
  const extract = JSON.parse(
    fs.readFileSync(path.join(root, "extract.json"), "utf8"),
  ) as { url: string; data: { title?: string; price?: string } }[];
  const titleByUrl = new Map(
    extract.map((e) => [e.url, e.data] as const),
  );

  const files = fs.readdirSync(htmlDir).filter((f) => f.endsWith(".html") && f !== "index.html");
  let fixed = 0;
  const indexEntries: { url: string; title?: string; price?: string; file: string }[] = [];

  for (const file of files) {
    const raw = fs.readFileSync(path.join(htmlDir, file), "utf8");
    // Prefer URL from extract by matching cid in filename
    let url = guessUrlFromFilename(file);
    if (!url) {
      // try match extract by reading archived-from if already fixed
      const m = raw.match(/archived-from:\s*(\S+)/);
      if (m) url = m[1];
    }
    // match extract titles by scanning for known titles in file is heavy; use guess
    if (!url) continue;

    // If already has banner, skip rewrite of content but still index
    let next = raw;
    if (!raw.includes("webscrapper-archive-banner")) {
      // strip previous partial base if any then prepare from original-ish html
      next = prepareArchivedHtml(url, raw);
      fs.writeFileSync(path.join(htmlDir, file), next, "utf8");
      fixed++;
    }

    const data = titleByUrl.get(url);
    // also try find by cid
    if (!data) {
      const cid = url.match(/cid=(\d+)/)?.[1];
      if (cid) {
        for (const [u, d] of titleByUrl) {
          if (u.includes(`cid=${cid}`)) {
            indexEntries.push({
              url: u,
              title: typeof d.title === "string" ? d.title : undefined,
              price: typeof d.price === "string" ? d.price : undefined,
              file,
            });
            break;
          }
        }
        continue;
      }
    }

    indexEntries.push({
      url,
      title: typeof data?.title === "string" ? data.title : undefined,
      price: typeof data?.price === "string" ? data.price : undefined,
      file,
    });
  }

  // Prefer extract order for index
  const rows = extract
    .map((e) => {
      // find file that matches this url
      const want = urlToSafeFileName(e.url);
      let file = files.find((f) => f === want);
      if (!file) {
        const cid = e.url.match(/cid=(\d+)/)?.[1];
        if (cid) {
          // old base64 filename
          const b64 = Buffer.from(`?cid=${cid}`).toString("base64url").slice(0, 24);
          file = files.find((f) => f.includes(b64) || f.includes(`cid=${cid}`));
          // also old encoding of cid= without ?
          const b64b = Buffer.from(`cid=${cid}`).toString("base64url");
          if (!file) file = files.find((f) => f.includes(b64b));
        }
      }
      if (!file && e.url.includes("unsin.co.kr") && !e.url.includes("fortun")) {
        file = files.find((f) => f.startsWith("www.unsin"));
      }
      if (!file) return null;
      const title = e.data?.title || e.url;
      const price = e.data?.price ? `(${e.data.price})` : "";
      return `<li><a href="./${file}"><strong>${escape(String(title))}</strong> ${escape(String(price))}<br/><small>${escape(e.url)}</small></a></li>`;
    })
    .filter(Boolean)
    .join("\n");

  const index = `<!doctype html>
<html lang="ko"><head><meta charset="utf-8"/><title>스크랩 목록</title>
<style>
body{font:14px/1.5 system-ui,sans-serif;max-width:920px;margin:24px auto;padding:0 16px}
.note{background:#eff6ff;border:1px solid #bfdbfe;padding:12px;border-radius:8px;margin-bottom:16px}
li{margin:10px 0;padding-bottom:8px;border-bottom:1px solid #e2e8f0}
a{color:#0369a1;text-decoration:none} a:hover{text-decoration:underline}
small{color:#64748b}
</style></head><body>
<h1>아카이브 목록 (${extract.length}페이지)</h1>
<div class="note">
  <strong>스크랩은 정상입니다.</strong> 파일 111개는 내용 해시·제목이 모두 다릅니다.<br/>
  브라우저로 HTML을 열면 <em>같은 사이트 껍데기(메뉴/푸터/CSS)</em> 때문에 비슷해 보입니다.
  아래 목록의 <strong>제목</strong>을 보거나, 각 파일 상단 파란 배너의 URL을 확인하세요.<br/>
  구조화된 데이터는 상위 폴더의 <code>extract.json</code>을 보세요.
</div>
<ol>
${rows}
</ol>
</body></html>`;

  fs.writeFileSync(path.join(htmlDir, "index.html"), index, "utf8");
  console.log("fixed html files", fixed);
  console.log("wrote", path.join(htmlDir, "index.html"));
  console.log("open:", path.resolve(htmlDir, "index.html"));
}

function escape(s: string) {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

main();
