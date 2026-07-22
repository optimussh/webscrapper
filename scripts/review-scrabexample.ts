import fs from "fs";
import path from "path";
import crypto from "crypto";
import * as cheerio from "cheerio";

const root = path.join("docs", "scrabexample");
const dir = path.join(root, "html");

function main() {
  const all = fs.readdirSync(dir).filter((f) => f.endsWith(".html"));
  const allHashes = new Map<string, string[]>();
  const titles = new Map<string, number>();
  const samples: {
    file: string;
    hash: string;
    h2: string;
    price: string;
    hasExternalAssets: boolean;
    baseHref?: string;
  }[] = [];

  for (const f of all) {
    const raw = fs.readFileSync(path.join(dir, f), "utf8");
    const h = crypto.createHash("sha256").update(raw).digest("hex");
    if (!allHashes.has(h)) allHashes.set(h, []);
    allHashes.get(h)!.push(f);

    const $ = cheerio.load(raw);
    const h2 = $("h2").first().text().replace(/\s+/g, " ").trim();
    const price = $("em.price").first().text().trim();
    if (h2) titles.set(h2, (titles.get(h2) || 0) + 1);

    if (samples.length < 12) {
      samples.push({
        file: f,
        hash: h.slice(0, 12),
        h2: h2.slice(0, 70),
        price,
        hasExternalAssets:
          raw.includes("https://") &&
          ($("link[href^='http']").length > 0 || $("script[src^='http']").length > 0),
        baseHref: $("base").attr("href"),
      });
    }
  }

  const extract = JSON.parse(
    fs.readFileSync(path.join(root, "extract.json"), "utf8"),
  ) as { url: string; data: { title?: string; price?: string } }[];
  const et = new Set(extract.map((e) => e.data?.title).filter(Boolean));
  const eu = new Set(extract.map((e) => e.url));

  console.log("=== FILE UNIQUENESS ===");
  console.log("total html files", all.length);
  console.log("unique content hashes", allHashes.size);
  const dups = [...allHashes.entries()].filter(([, files]) => files.length > 1);
  console.log("duplicate groups", dups.length);
  if (dups.length) {
    console.log("example dup", dups[0][1].slice(0, 5));
  }

  console.log("\n=== H2 TITLES IN HTML ===");
  console.log("unique h2", titles.size);
  console.log(
    "top titles",
    [...titles.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 8),
  );

  console.log("\n=== EXTRACT.JSON ===");
  console.log("rows", extract.length, "unique titles", et.size, "unique urls", eu.size);

  console.log("\n=== SAMPLE FILES ===");
  for (const s of samples) console.log(JSON.stringify(s));

  // Why browser looks the same: relative asset / JS shell
  const one = fs.readFileSync(path.join(dir, all.find((f) => f.includes("intro"))!), "utf8");
  const $ = cheerio.load(one);
  console.log("\n=== WHY OPENING HTML MAY LOOK IDENTICAL ===");
  console.log("link[href] sample", $("link[href]").slice(0, 5).map((_, e) => $(e).attr("href")).get());
  console.log("script[src] sample", $("script[src]").slice(0, 5).map((_, e) => $(e).attr("src")).get());
  console.log("img[src] sample", $("img[src]").slice(0, 3).map((_, e) => $(e).attr("src")).get());
  console.log(
    "relative css count",
    $("link[href]").filter((_, e) => !/^https?:/i.test($(e).attr("href") || "")).length,
  );
  console.log(
    "absolute css/js count",
    $("link[href^='http'], script[src^='http']").length,
  );
}

main();
