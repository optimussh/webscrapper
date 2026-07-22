/**
 * Payment UI capture for design benchmarking.
 * Opens product detail → submits purchase form → stops on payment page.
 * Does NOT complete payment / fill card details.
 */
import { chromium, type Browser, type Page } from "playwright";
import fs from "fs/promises";
import path from "path";
import * as cheerio from "cheerio";
import type { PaymentCapture } from "../lib/types";
import { jobDir, prepareArchivedHtml, urlToSafeFileName } from "../lib/jobs";

const PAYMENT_URL_HINT =
  /buycash|\/buy\/|payment|pay\/|order\/checkout|결제/i;

/** Product detail pages that typically lead to payment. */
export function isProductDetailUrl(url: string): boolean {
  try {
    const u = new URL(url);
    if (/intro\.php/i.test(u.pathname) && u.searchParams.has("cid")) return true;
    if (/fortun\./i.test(u.hostname) && /cid=/i.test(u.search)) return true;
    return false;
  } catch {
    return false;
  }
}

function analyzePaymentHtml(html: string, pageUrl: string): Omit<
  PaymentCapture,
  "detailUrl" | "ok" | "capturedAt" | "htmlFile" | "screenshotFile" | "error"
> {
  const $ = cheerio.load(html);
  $("script, style, noscript").remove();
  const bodyText = $("body").text().replace(/\s+/g, " ").trim();

  const paymentMethods: string[] = [];
  const methodHints = [
    "신용카드",
    "체크카드",
    "인터넷뱅킹",
    "계좌이체",
    "휴대폰",
    "폰빌",
    "네이버페이",
    "카카오페이",
    "삼성페이",
    "토스",
    "페이코",
    "문화상품권",
    "도서문화상품권",
    "무통장",
  ];
  for (const m of methodHints) {
    if (bodyText.includes(m) && !paymentMethods.includes(m)) paymentMethods.push(m);
  }
  // radio/label scan
  $("label, .pay, [class*='pay'], [class*='method']").each((_, el) => {
    const t = $(el).text().replace(/\s+/g, " ").trim();
    if (t.length >= 2 && t.length <= 20 && /페이|카드|뱅킹|휴대폰|상품권/.test(t)) {
      if (!paymentMethods.includes(t)) paymentMethods.push(t);
    }
  });

  const ctaLabels: string[] = [];
  $("button, input[type='submit'], a.btn, .btn").each((_, el) => {
    const t = (
      $(el).attr("value") ||
      $(el).text() ||
      ""
    )
      .replace(/\s+/g, " ")
      .trim();
    if (t && /결제|구매|확인|취소|동의|다음/.test(t) && t.length < 40) {
      if (!ctaLabels.includes(t)) ctaLabels.push(t);
    }
  });

  const formFields: PaymentCapture["formFields"] = [];
  $("input, select, textarea").each((_, el) => {
    const type = ($(el).attr("type") || el.tagName || "text").toLowerCase();
    if (type === "hidden") return;
    const name = $(el).attr("name") || $(el).attr("id") || "";
    if (!name) return;
    const id = $(el).attr("id");
    let label = "";
    if (id) {
      label = $(`label[for='${id}']`).text().replace(/\s+/g, " ").trim();
    }
    formFields.push({ name, type, label: label || undefined });
  });

  const notices: string[] = [];
  $("li, p, .notice, .alert, .caution, [class*='note']").each((_, el) => {
    const t = $(el).text().replace(/\s+/g, " ").trim();
    if (
      t.length > 15 &&
      t.length < 200 &&
      /환불|결제|유의|문의|다시보기|실수|고객센터/.test(t)
    ) {
      if (notices.length < 12) notices.push(t);
    }
  });

  // title / amount heuristics (keep short — avoid privacy policy dump)
  const amountMatch =
    bodyText.match(/요금\s*([0-9,]+)\s*원/) ||
    bodyText.match(/([0-9,]{3,})\s*원/);
  let productTitle: string | undefined;
  $("td, th, span, div, dt, dd").each((_, el) => {
    if (productTitle) return;
    const t = $(el).text().replace(/\s+/g, " ").trim();
    if (/^컨텐츠\s*명/.test(t) && t.length < 120) {
      productTitle = t.replace(/^컨텐츠\s*명\s*[:：]?\s*/, "").trim() || undefined;
    }
  });

  return {
    paymentUrl: pageUrl,
    productTitle,
    amountHint: amountMatch?.[1] ? `${amountMatch[1]}원` : undefined,
    paymentMethods: paymentMethods.slice(0, 20),
    ctaLabels: ctaLabels.slice(0, 15),
    formFields: formFields.slice(0, 40),
    notices: notices.slice(0, 12),
  };
}

async function tryReachPaymentPage(page: Page, detailUrl: string): Promise<boolean> {
  await page.goto(detailUrl, { waitUntil: "domcontentloaded", timeout: 60000 });
  await page.waitForTimeout(1200);

  // Prefer product form if present
  const hasForm = await page.locator("#testForm").count();
  if (hasForm) {
    // Ensure cards field not empty when required
    await page.evaluate(() => {
      const cards = document.querySelector("#selCards") as HTMLInputElement | null;
      if (cards && !cards.value) {
        cards.value = "1,2,3,4,5,6,7,8,9";
      }
      const f = document.querySelector("#testForm") as HTMLFormElement;
      if (!f) return;
      // Site JS often sets action dynamically; force known payment endpoint for UI capture
      f.action = "https://www.unsin.co.kr/unse/fortun/buycash/result";
      f.method = "post";
      f.submit();
    });
    try {
      await page.waitForURL(PAYMENT_URL_HINT, { timeout: 20000 });
    } catch {
      await page.waitForTimeout(2000);
    }
    return PAYMENT_URL_HINT.test(page.url()) || /buycash/i.test(page.url());
  }

  // Generic: click CTA that looks like purchase
  const cta = page
    .locator(
      "button:has-text('운세보기'), button:has-text('결제'), button:has-text('구매'), a:has-text('운세보기'), a:has-text('결제하기')",
    )
    .first();
  if (await cta.count()) {
    await Promise.all([
      page.waitForURL(PAYMENT_URL_HINT, { timeout: 15000 }).catch(() => null),
      cta.click({ force: true }).catch(() => null),
    ]);
    await page.waitForTimeout(1500);
    return PAYMENT_URL_HINT.test(page.url());
  }

  return false;
}

export async function capturePaymentForDetails(
  jobId: string,
  detailUrls: string[],
  onProgress?: (done: number, total: number, url: string) => void,
): Promise<PaymentCapture[]> {
  const unique = [...new Set(detailUrls.filter(isProductDetailUrl))];
  if (!unique.length) return [];

  const outDir = path.join(jobDir(jobId), "payment");
  const htmlDir = path.join(outDir, "html");
  const shotDir = path.join(outDir, "screenshots");
  await fs.mkdir(htmlDir, { recursive: true });
  await fs.mkdir(shotDir, { recursive: true });

  let browser: Browser | null = null;
  const results: PaymentCapture[] = [];

  try {
    browser = await chromium.launch({ headless: true });
    // Serial capture is more stable for form POST + cookies
    for (let i = 0; i < unique.length; i++) {
      const detailUrl = unique[i];
      onProgress?.(i, unique.length, detailUrl);
      const capturedAt = new Date().toISOString();
      const context = await browser.newContext({
        userAgent:
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
        locale: "ko-KR",
      });
      const page = await context.newPage();
      page.setDefaultTimeout(45000);

      try {
        // Read detail title before navigating away
        await page.goto(detailUrl, { waitUntil: "domcontentloaded", timeout: 60000 });
        await page.waitForTimeout(800);
        const detailTitle = (
          await page.locator("h2").first().textContent().catch(() => null)
        )
          ?.replace(/\s+/g, " ")
          .trim();
        const detailPrice = (
          await page.locator("em.price").first().textContent().catch(() => null)
        )
          ?.replace(/\s+/g, " ")
          .trim();

        const ok = await tryReachPaymentPage(page, detailUrl);
        if (!ok) {
          results.push({
            detailUrl,
            ok: false,
            error: `Payment page not reached (final: ${page.url()})`,
            productTitle: detailTitle || undefined,
            amountHint: detailPrice ? `${detailPrice}원` : undefined,
            paymentMethods: [],
            ctaLabels: [],
            formFields: [],
            notices: [],
            capturedAt,
          });
          await context.close();
          continue;
        }

        await page.waitForTimeout(800);
        // Safety: never click final pay buttons — DOM snapshot only

        const paymentUrl = page.url();
        const html = await page.content();
        const analysis = analyzePaymentHtml(html, paymentUrl);
        if (!analysis.productTitle && detailTitle) {
          analysis.productTitle = detailTitle;
        }
        if (
          (!analysis.amountHint || analysis.amountHint === "0원") &&
          detailPrice
        ) {
          analysis.amountHint = /원$/.test(detailPrice)
            ? detailPrice
            : `${detailPrice}원`;
        }

        const baseName = urlToSafeFileName(detailUrl).replace(/\.html$/i, "");
        const htmlFile = path.join("payment", "html", `${baseName}.pay.html`);
        const screenshotFile = path.join(
          "payment",
          "screenshots",
          `${baseName}.pay.png`,
        );

        await fs.writeFile(
          path.join(jobDir(jobId), htmlFile),
          prepareArchivedHtml(paymentUrl, html),
          "utf8",
        );
        await page.screenshot({
          path: path.join(jobDir(jobId), screenshotFile),
          fullPage: true,
        });

        results.push({
          detailUrl,
          ok: true,
          ...analysis,
          paymentUrl,
          htmlFile,
          screenshotFile,
          capturedAt,
        });
      } catch (err) {
        results.push({
          detailUrl,
          ok: false,
          error: err instanceof Error ? err.message : String(err),
          paymentMethods: [],
          ctaLabels: [],
          formFields: [],
          notices: [],
          capturedAt,
        });
      } finally {
        await context.close().catch(() => undefined);
      }
    }
  } finally {
    await browser?.close().catch(() => undefined);
  }

  await fs.writeFile(
    path.join(outDir, "payment.json"),
    JSON.stringify(results, null, 2),
    "utf8",
  );

  // Index for humans
  const rows = results
    .map((r) => {
      const title = r.productTitle || r.detailUrl;
      const status = r.ok ? "OK" : `FAIL: ${r.error || ""}`;
      const shot = r.screenshotFile
        ? `<a href="../${r.screenshotFile}">screenshot</a>`
        : "";
      const html = r.htmlFile ? `<a href="../${r.htmlFile}">html</a>` : "";
      const methods = r.paymentMethods.join(", ");
      return `<tr>
        <td>${escape(status)}</td>
        <td>${escape(title)}<br/><small>${escape(r.detailUrl)}</small></td>
        <td>${escape(r.amountHint || "")}</td>
        <td>${escape(methods)}</td>
        <td>${escape((r.ctaLabels || []).join(" / "))}</td>
        <td>${html} ${shot}</td>
      </tr>`;
    })
    .join("\n");

  const index = `<!doctype html>
<html lang="ko"><head><meta charset="utf-8"/>
<title>결제 화면 벤치마크 (${results.length})</title>
<style>
body{font:13px/1.45 system-ui,sans-serif;margin:20px;color:#0f172a}
.note{background:#fff7ed;border:1px solid #fed7aa;padding:10px 12px;border-radius:8px;margin-bottom:14px}
table{border-collapse:collapse;width:100%} th,td{border:1px solid #e2e8f0;padding:8px;vertical-align:top}
th{background:#f8fafc;text-align:left} small{color:#64748b}
</style></head><body>
<h1>결제 화면 캡처 (${results.filter((r) => r.ok).length}/${results.length} 성공)</h1>
<div class="note">
  <strong>벤치마킹용 스냅샷</strong>입니다. 결제 완료·카드 입력은 수행하지 않습니다.<br/>
  일부 상품은 요금이 0원으로 표시될 수 있으나, 결제수단·폼·약관·CTA 레이아웃 비교에 사용합니다.
</div>
<table>
<thead><tr><th>상태</th><th>상품</th><th>금액</th><th>결제수단</th><th>CTA</th><th>파일</th></tr></thead>
<tbody>
${rows}
</tbody>
</table>
</body></html>`;

  await fs.writeFile(path.join(outDir, "index.html"), index, "utf8");
  return results;
}

function escape(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
