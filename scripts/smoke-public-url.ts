import { assertPublicHttpUrl } from "../src/lib/public-url";

const blocked = [
  "http://127.0.0.1/",
  "http://localhost/admin",
  "http://169.254.169.254/",
  "http://10.0.0.5/",
  "http://192.168.0.8/",
  "http://[::1]/",
  "https://user:pass@example.com/",
];

async function main() {
  for (const url of blocked) {
    try {
      await assertPublicHttpUrl(url);
      throw new Error(`allowed private url ${url}`);
    } catch (err) {
      if (err instanceof Error && err.message.startsWith("allowed private")) throw err;
      console.log("BLOCK", url);
    }
  }
  await assertPublicHttpUrl("https://example.com/");
  console.log("ALLOW https://example.com/");
  console.log("OK");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
