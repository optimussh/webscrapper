import { execFile, spawn } from "node:child_process";
import { createHash } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import * as cheerio from "cheerio";
import { assertPublicHttpUrl } from "./public-url";
import type { DesignObservations, MirrorReport } from "./types";
import { normalizeUrl } from "./url";

const execFileAsync = promisify(execFile);

const UA = "webscrapper/1.0 (local reference archive)";
const MAX_TOTAL_BYTES = 50 * 1024 * 1024;
const MAX_FILE_BYTES = 8 * 1024 * 1024;
const MAX_FILES = 400;
const SKIP_EXT = new Set([
  ".mp4",
  ".webm",
  ".mp3",
  ".zip",
  ".exe",
  ".dmg",
  ".iso",
  ".msi",
  ".7z",
  ".avi",
  ".mov",
  ".wmv",
  ".pdf",
]);

type RobotsRule = { allow: boolean; path: string };

export async function captureDesignMirror(options: {
  jobRoot: string;
  pageUrls: string[];
  forceNode?: boolean;
}): Promise<MirrorReport> {
  const mirrorDir = path.join(options.jobRoot, "reference", "mirror");
  const siteDir = path.join(mirrorDir, "site");
  await fs.mkdir(siteDir, { recursive: true });

  const pageUrls = await publicPages(options.pageUrls);
  const skipped: string[] = [];
  if (!pageUrls.length) {
    const report: MirrorReport = {
      engine: "node-requisites",
      command: "",
      exitCode: 1,
      files: 0,
      bytes: 0,
      skipped,
      note: "No public http(s) page URLs to mirror",
    };
    await writeReport(mirrorDir, report);
    return report;
  }

  const command = wgetCommand(pageUrls.length);
  await fs.writeFile(path.join(mirrorDir, "urls.txt"), pageUrls.join("\n"), "utf8");
  await fs.writeFile(path.join(mirrorDir, "wget-command.txt"), `${command}\n`, "utf8");

  let report: MirrorReport;
  const wgetBin = options.forceNode ? null : await findWget();
  if (wgetBin) {
    const run = await runWget(wgetBin, mirrorDir);
    const measured = await measure(siteDir);
    report = {
      engine: "gnu-wget",
      command,
      exitCode: run.code,
      files: measured.files,
      bytes: measured.bytes,
      skipped,
      note: run.note,
    };
    if (measured.files === 0) {
      const fallback = await nodeRequisites(pageUrls, siteDir, skipped);
      report = {
        ...fallback,
        command,
        note: `GNU wget produced no files (${run.note || `exit ${run.code}`}). ${fallback.note || "Used node page-requisites."}`,
      };
    }
  } else {
    report = await nodeRequisites(pageUrls, siteDir, skipped);
    report.command = command;
    report.note = options.forceNode
      ? "Node page-requisites (forced)."
      : `GNU wget was not found. ${report.note || "Used node page-requisites."}`;
  }

  await writeObservations(options.jobRoot, siteDir);
  await writeReport(mirrorDir, report);
  return report;
}

async function publicPages(urls: string[]): Promise<string[]> {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const raw of urls) {
    try {
      const url = await assertPublicHttpUrl(raw);
      const key = normalizeUrl(url.toString()) || url.toString();
      if (seen.has(key)) continue;
      seen.add(key);
      out.push(key);
    } catch {
      // Skip private, credentialed, or unresolvable URLs.
    }
  }
  return out;
}

function wgetCommand(pageCount: number): string {
  return [
    "wget",
    "--input-file=urls.txt",
    "--directory-prefix=site",
    "--page-requisites",
    "--convert-links",
    "--adjust-extension",
    "--span-hosts",
    "--restrict-file-names=windows",
    "--quota=50m",
    "--timeout=20",
    "--tries=2",
    "--wait=0.4",
    "--random-wait",
    "--max-redirect=5",
    "--no-cookies",
    "--execute",
    "robots=on",
    `--user-agent=${UA}`,
    "--reject=mp4,webm,mp3,zip,exe,dmg,iso,msi,7z,avi,mov,wmv,pdf",
    "--no-verbose",
    `# ${pageCount} crawled page(s); no extra HTML recursion`,
  ].join(" ");
}

async function findWget(): Promise<string | null> {
  const envPath = process.env.WGET_PATH;
  if (envPath && (await exists(envPath))) return envPath;

  try {
    const { stdout } = await execFileAsync("where.exe", ["wget"], {
      windowsHide: true,
      timeout: 8000,
    });
    for (const line of stdout.split(/\r?\n/)) {
      const candidate = line.trim();
      if (path.basename(candidate).toLowerCase() === "wget.exe" && (await exists(candidate))) {
        return candidate;
      }
    }
  } catch {
    // where.exe misses wget when the installer's PATH update is not in this process.
  }

  const roots = [
    path.join(process.env.LOCALAPPDATA || "", "Microsoft", "WinGet", "Packages"),
    path.join(process.env.LOCALAPPDATA || "", "Microsoft", "WinGet", "Links"),
    "C:\\Program Files\\Wget",
  ];
  for (const root of roots) {
    const hit = await findNamed(root, "wget.exe", 2);
    if (hit) return hit;
  }
  return null;
}

async function findNamed(dir: string, name: string, depth: number): Promise<string | null> {
  if (depth < 0) return null;
  let entries;
  try {
    entries = await fs.readdir(dir, { withFileTypes: true });
  } catch {
    return null;
  }
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isFile() && entry.name.toLowerCase() === name.toLowerCase()) return full;
    if (entry.isDirectory()) {
      const hit = await findNamed(full, name, depth - 1);
      if (hit) return hit;
    }
  }
  return null;
}

async function exists(file: string): Promise<boolean> {
  try {
    await fs.access(file);
    return true;
  } catch {
    return false;
  }
}

function runWget(bin: string, cwd: string): Promise<{ code: number | null; note?: string }> {
  return new Promise((resolve) => {
    const child = spawn(
      bin,
      [
        "--input-file=urls.txt",
        "--directory-prefix=site",
        "--page-requisites",
        "--convert-links",
        "--adjust-extension",
        "--span-hosts",
        "--restrict-file-names=windows",
        "--quota=50m",
        "--timeout=20",
        "--tries=2",
        "--wait=0.4",
        "--random-wait",
        "--max-redirect=5",
        "--no-cookies",
        "--execute",
        "robots=on",
        `--user-agent=${UA}`,
        "--reject=mp4,webm,mp3,zip,exe,dmg,iso,msi,7z,avi,mov,wmv,pdf",
        "--no-verbose",
      ],
      { cwd, windowsHide: true, shell: false },
    );
    let stderr = "";
    const timer = setTimeout(() => {
      child.kill();
    }, 180_000);
    child.stderr.on("data", (chunk: Buffer) => {
      stderr += chunk.toString();
      if (stderr.length > 4000) stderr = stderr.slice(-4000);
    });
    child.on("error", (err) => {
      clearTimeout(timer);
      resolve({ code: 1, note: err.message });
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      const note = code === 0 ? undefined : stderr.trim().slice(0, 500) || `wget exit ${code}`;
      resolve({ code, note });
    });
  });
}

async function nodeRequisites(
  pageUrls: string[],
  siteDir: string,
  skipped: string[],
): Promise<MirrorReport> {
  const saved = new Map<string, string>();
  let total = 0;
  const robotsCache = new Map<string, RobotsRule[]>();

  const remember = (url: string, file: string, size: number) => {
    saved.set(url, file);
    total += size;
  };

  for (const pageUrl of pageUrls) {
    if (saved.size >= MAX_FILES || total >= MAX_TOTAL_BYTES) break;
    if (!(await robotsAllow(pageUrl, robotsCache))) {
      skipped.push(`robots ${pageUrl}`);
      continue;
    }
    const downloaded = await downloadPublic(pageUrl);
    if (!downloaded) {
      skipped.push(pageUrl);
      continue;
    }
    const rel = safeRelative(downloaded.finalUrl, true);
    const file = await writeInside(siteDir, rel, downloaded.buf);
    if (!file) {
      skipped.push(pageUrl);
      continue;
    }
    remember(normalizeUrl(downloaded.finalUrl) || downloaded.finalUrl, file, downloaded.buf.length);
    await pause();

    const assets = collectAssets(downloaded.buf.toString("utf8"), downloaded.finalUrl);
    const queue = [...new Set(assets)];
    let cssImports = 0;
    while (queue.length && saved.size < MAX_FILES && total < MAX_TOTAL_BYTES) {
      const assetUrl = queue.shift()!;
      const key = normalizeUrl(assetUrl) || assetUrl;
      if (saved.has(key)) continue;
      if (skipExtension(assetUrl)) {
        skipped.push(assetUrl);
        continue;
      }
      if (!(await robotsAllow(assetUrl, robotsCache))) {
        skipped.push(`robots ${assetUrl}`);
        continue;
      }
      const asset = await downloadPublic(assetUrl);
      if (!asset) {
        skipped.push(assetUrl);
        continue;
      }
      const assetRel = safeRelative(asset.finalUrl, false);
      const assetFile = await writeInside(siteDir, assetRel, asset.buf);
      if (!assetFile) {
        skipped.push(assetUrl);
        continue;
      }
      remember(key, assetFile, asset.buf.length);
      const isCss =
        asset.contentType.includes("text/css") || assetFile.toLowerCase().endsWith(".css");
      if (isCss && cssImports < 20) {
        cssImports += 1;
        for (const next of cssRefs(asset.buf.toString("utf8"), asset.finalUrl)) {
          if (!saved.has(normalizeUrl(next) || next)) queue.push(next);
        }
      }
      await pause();
    }
  }

  await rewriteLocalLinks(saved);
  const measured = await measure(siteDir);
  return {
    engine: "node-requisites",
    command: "",
    exitCode: measured.files > 0 ? 0 : 1,
    files: measured.files,
    bytes: measured.bytes,
    skipped: skipped.slice(0, 40),
    note: measured.files > 0 ? "Node page-requisites." : "Node page-requisites downloaded nothing.",
  };
}

async function downloadPublic(
  raw: string,
): Promise<{ buf: Buffer; finalUrl: string; contentType: string } | null> {
  let current = raw;
  for (let hop = 0; hop < 5; hop += 1) {
    let url: URL;
    try {
      url = await assertPublicHttpUrl(current);
    } catch {
      return null;
    }
    let response: Response;
    try {
      response = await fetch(url, {
        redirect: "manual",
        signal: AbortSignal.timeout(20_000),
        headers: { "user-agent": UA, accept: "*/*" },
      });
    } catch {
      return null;
    }
    if ([301, 302, 303, 307, 308].includes(response.status)) {
      const location = response.headers.get("location");
      if (!location) return null;
      current = new URL(location, url).toString();
      continue;
    }
    if (!response.ok || !response.body) return null;
    const advertised = Number(response.headers.get("content-length") || 0);
    if (advertised > MAX_FILE_BYTES) return null;
    const reader = response.body.getReader();
    const chunks: Buffer[] = [];
    let size = 0;
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > MAX_FILE_BYTES) {
        await reader.cancel();
        return null;
      }
      chunks.push(Buffer.from(value));
    }
    return {
      buf: Buffer.concat(chunks),
      finalUrl: url.toString(),
      contentType: (response.headers.get("content-type") || "").toLowerCase(),
    };
  }
  return null;
}

function collectAssets(html: string, base: string): string[] {
  const $ = cheerio.load(html);
  const found: string[] = [];
  const add = (raw?: string | null) => {
    if (!raw) return;
    const trimmed = raw.trim();
    if (
      !trimmed ||
      trimmed.startsWith("data:") ||
      trimmed.startsWith("blob:") ||
      trimmed.startsWith("javascript:") ||
      trimmed.startsWith("#")
    ) {
      return;
    }
    const normalized = normalizeUrl(trimmed, base);
    if (normalized) found.push(normalized);
  };

  $("link[href]").each((_, el) => {
    const rel = ($(el).attr("rel") || "").toLowerCase();
    const as = ($(el).attr("as") || "").toLowerCase();
    const useful =
      rel.includes("stylesheet") ||
      rel.includes("icon") ||
      rel.includes("preload") ||
      rel.includes("font") ||
      as === "style" ||
      as === "script" ||
      as === "font" ||
      as === "image";
    if (useful) add($(el).attr("href"));
  });
  $("script[src]").each((_, el) => add($(el).attr("src")));
  $("img[src], source[src], video[poster], img[poster]").each((_, el) => {
    add($(el).attr("src"));
    add($(el).attr("poster"));
  });
  $("[srcset]").each((_, el) => {
    for (const part of ($(el).attr("srcset") || "").split(",")) {
      add(part.trim().split(/\s+/)[0]);
    }
  });
  $("style").each((_, el) => {
    found.push(...cssRefs($(el).text() || "", base));
  });
  $("[style]").each((_, el) => {
    found.push(...cssRefs($(el).attr("style") || "", base));
  });
  return found;
}

function cssRefs(css: string, base: string): string[] {
  const out: string[] = [];
  const urlRe = /url\(\s*(['"]?)([^'")]+)\1\s*\)/gi;
  const importRe = /@import\s+(?:url\(\s*)?['"]([^'"]+)['"]/gi;
  for (const match of css.matchAll(urlRe)) {
    const raw = match[2]?.trim();
    if (!raw || raw.startsWith("data:")) continue;
    const normalized = normalizeUrl(raw, base);
    if (normalized) out.push(normalized);
  }
  for (const match of css.matchAll(importRe)) {
    const normalized = normalizeUrl(match[1], base);
    if (normalized) out.push(normalized);
  }
  return out;
}

function skipExtension(url: string): boolean {
  try {
    const pathname = new URL(url).pathname.toLowerCase();
    const base = pathname.split("/").pop() || "";
    const dot = base.lastIndexOf(".");
    if (dot <= 0) return false;
    return SKIP_EXT.has(base.slice(dot));
  } catch {
    return true;
  }
}

function safeRelative(urlStr: string, asHtml: boolean): string {
  const url = new URL(urlStr);
  const host = url.hostname.replace(/[^a-zA-Z0-9.-]/g, "_");
  const parts = url.pathname
    .split("/")
    .filter((part) => part && part !== "." && part !== "..")
    .map((part) => sanitizeSegment(part));
  if (!parts.length) parts.push(asHtml ? "index.html" : "index");
  let last = parts[parts.length - 1];
  if (asHtml && !path.win32.extname(last) && !path.posix.extname(last)) last += ".html";
  if (url.search) {
    const hash = createHash("sha1").update(url.search).digest("hex").slice(0, 8);
    const ext = path.posix.extname(last);
    const base = path.posix.basename(last, ext);
    last = `${base}-${hash}${ext}`;
  }
  parts[parts.length - 1] = last;
  return path.join(host, ...parts);
}

function sanitizeSegment(segment: string): string {
  let decoded = segment;
  try {
    decoded = decodeURIComponent(segment);
  } catch {
    decoded = segment;
  }
  const cleaned = decoded.replace(/[<>:"|?*\u0000-\u001f]/g, "_").replace(/\.+$/g, "");
  return cleaned || "_";
}

async function writeInside(root: string, rel: string, data: Buffer): Promise<string | null> {
  const file = path.resolve(root, rel);
  const rootResolved = path.resolve(root);
  if (!file.startsWith(rootResolved + path.sep) && file !== rootResolved) return null;
  await fs.mkdir(path.dirname(file), { recursive: true });
  await fs.writeFile(file, data);
  return file;
}

async function rewriteLocalLinks(saved: Map<string, string>): Promise<void> {
  const entries = [...saved.entries()].sort((a, b) => b[0].length - a[0].length);
  for (const [, file] of saved) {
    const ext = path.extname(file).toLowerCase();
    if (ext !== ".html" && ext !== ".css") continue;
    let text = await fs.readFile(file, "utf8");
    for (const [url, target] of entries) {
      const rel = relativeLink(file, target);
      text = text.split(url).join(rel);
      if (url.startsWith("https:")) text = text.split(url.slice("https:".length)).join(rel);
      else if (url.startsWith("http:")) text = text.split(url.slice("http:".length)).join(rel);
    }
    await fs.writeFile(file, text, "utf8");
  }
}

function relativeLink(fromFile: string, toFile: string): string {
  let rel = path.relative(path.dirname(fromFile), toFile).split(path.sep).join("/");
  if (!rel.startsWith(".")) rel = `./${rel}`;
  return rel;
}

async function robotsAllow(raw: string, cache: Map<string, RobotsRule[]>): Promise<boolean> {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return false;
  }
  let rules = cache.get(url.origin);
  if (!rules) {
    rules = await loadRobots(url.origin);
    cache.set(url.origin, rules);
  }
  let matched: RobotsRule | null = null;
  for (const rule of rules) {
    if (!rule.path) continue;
    if (url.pathname.startsWith(rule.path) && (!matched || rule.path.length > matched.path.length)) {
      matched = rule;
    }
  }
  return matched ? matched.allow : true;
}

async function loadRobots(origin: string): Promise<RobotsRule[]> {
  try {
    await assertPublicHttpUrl(`${origin}/robots.txt`);
    const response = await fetch(`${origin}/robots.txt`, {
      signal: AbortSignal.timeout(8000),
      headers: { "user-agent": UA },
    });
    if (!response.ok) return [];
    const text = await response.text();
    return starRules(text.slice(0, 200_000));
  } catch {
    return [];
  }
}

function starRules(text: string): RobotsRule[] {
  let star = false;
  let seenStar = false;
  const rules: RobotsRule[] = [];
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.replace(/#.*/, "").trim();
    if (!line) continue;
    const idx = line.indexOf(":");
    if (idx < 0) continue;
    const key = line.slice(0, idx).trim().toLowerCase();
    const value = line.slice(idx + 1).trim();
    if (key === "user-agent") {
      if (seenStar && star) return rules;
      star = value === "*";
      if (star) seenStar = true;
      continue;
    }
    if (!star || !value) continue;
    if (key === "allow" || key === "disallow") {
      rules.push({ allow: key === "allow", path: value });
    }
  }
  return rules;
}

async function writeObservations(jobRoot: string, siteDir: string): Promise<void> {
  const observations = await scanDesignObservations(siteDir);
  await fs.mkdir(path.join(jobRoot, "reference"), { recursive: true });
  await fs.writeFile(
    path.join(jobRoot, "reference", "design-observations.json"),
    JSON.stringify(observations, null, 2),
    "utf8",
  );
}

async function scanDesignObservations(siteDir: string): Promise<DesignObservations> {
  const fonts = new Map<string, number>();
  const colors = new Map<string, number>();
  const stylesheets: string[] = [];
  const files = await listFiles(siteDir);
  let scanned = 0;
  for (const file of files) {
    const ext = path.extname(file).toLowerCase();
    if (ext === ".css") stylesheets.push(path.relative(siteDir, file).split(path.sep).join("/"));
    if (ext !== ".css" && ext !== ".html") continue;
    if (scanned >= 40) continue;
    const stat = await fs.stat(file);
    if (stat.size > 512 * 1024) continue;
    scanned += 1;
    const text = await fs.readFile(file, "utf8");
    collectFonts(text, fonts);
    collectColors(text, colors);
  }
  return {
    note: "Observation only. Do not copy these colors, font files, or stylesheets into a new project. Pick an original palette and an OFL or Apache-2.0 font.",
    fonts: topCounts(fonts, 16),
    colors: topCounts(colors, 24),
    stylesheets: stylesheets.slice(0, 40),
  };
}

function collectFonts(css: string, fonts: Map<string, number>): void {
  const generic = new Set([
    "serif",
    "sans-serif",
    "monospace",
    "cursive",
    "fantasy",
    "system-ui",
    "ui-sans-serif",
    "ui-serif",
    "ui-monospace",
    "inherit",
    "initial",
    "unset",
    "emoji",
    "math",
    "fangsong",
  ]);
  for (const match of css.matchAll(/font-family\s*:\s*([^;}{]+)/gi)) {
    for (const part of match[1].split(",")) {
      const name = part.trim().replace(/^['"]|['"]$/g, "").trim();
      if (!name || generic.has(name.toLowerCase()) || name.length > 80) continue;
      fonts.set(name, (fonts.get(name) || 0) + 1);
    }
  }
}

function collectColors(css: string, colors: Map<string, number>): void {
  for (const match of css.matchAll(/#([0-9a-fA-F]{3,8})\b/g)) {
    const hex = normalizeHex(match[1]);
    if (!hex) continue;
    colors.set(hex, (colors.get(hex) || 0) + 1);
  }
}

function normalizeHex(raw: string): string | null {
  const hex = raw.toLowerCase();
  if (hex.length === 3 || hex.length === 4) {
    return `#${hex
      .slice(0, 3)
      .split("")
      .map((ch) => ch + ch)
      .join("")}`;
  }
  if (hex.length === 6 || hex.length === 8) return `#${hex.slice(0, 6)}`;
  return null;
}

function topCounts(map: Map<string, number>, limit: number): { value: string; count: number }[] {
  return [...map.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, limit)
    .map(([value, count]) => ({ value, count }));
}

async function listFiles(dir: string): Promise<string[]> {
  const out: string[] = [];
  async function walk(current: string) {
    let entries;
    try {
      entries = await fs.readdir(current, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      const full = path.join(current, entry.name);
      if (entry.isDirectory()) await walk(full);
      else out.push(full);
    }
  }
  await walk(dir);
  return out;
}

async function measure(dir: string): Promise<{ files: number; bytes: number }> {
  const files = await listFiles(dir);
  let bytes = 0;
  for (const file of files) {
    try {
      bytes += (await fs.stat(file)).size;
    } catch {
      // File disappeared between listing and stat.
    }
  }
  return { files: files.length, bytes };
}

async function writeReport(mirrorDir: string, report: MirrorReport): Promise<void> {
  await fs.mkdir(mirrorDir, { recursive: true });
  await fs.writeFile(path.join(mirrorDir, "report.json"), JSON.stringify(report, null, 2), "utf8");
}

function pause(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 250));
}
