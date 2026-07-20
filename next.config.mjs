/** @type {import('next').NextConfig} */
const nextConfig = {
  serverExternalPackages: [
    "crawlee",
    "playwright",
    "cheerio",
    "jszip",
    "@crawlee/cheerio",
    "@crawlee/playwright",
    "@crawlee/basic",
    "@crawlee/browser",
    "@crawlee/http",
  ],
};

export default nextConfig;
