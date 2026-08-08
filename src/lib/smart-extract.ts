import type { Extractor } from "./types";

/**
 * Scrapling-inspired adaptive defaults: common commerce / content fields.
 * Used when smartExtract is on; merged under user extractors (user wins).
 */
export const SMART_EXTRACTORS: Extractor[] = [
  { name: "title", selector: "h1, h2, [itemprop='name']", attr: "text", multiple: false },
  {
    name: "description",
    selector: "meta[name='description'], meta[property='og:description']",
    attr: "content",
    multiple: false,
  },
  {
    name: "price",
    selector:
      "em.price, .price, [class*='price'], [itemprop='price'], [data-price], .cost, .amount",
    attr: "text",
    multiple: true,
  },
  {
    name: "cta",
    selector:
      "a.btn, button, [class*='cta'], [class*='buy'], input[type='submit'], a[class*='button']",
    attr: "text",
    multiple: true,
  },
  {
    name: "sections",
    selector: "main h2, article h2, .content h2, h2, h3",
    attr: "text",
    multiple: true,
  },
  {
    name: "images",
    selector: "main img, article img, .product img, img[itemprop='image']",
    attr: "src",
    multiple: true,
  },
];

/** User extractors override smart ones with the same name. */
export function mergeExtractors(
  user: Extractor[] | undefined,
  smart: boolean,
): Extractor[] {
  if (!smart) return user?.length ? user : [];
  const byName = new Map<string, Extractor>();
  for (const ex of SMART_EXTRACTORS) byName.set(ex.name, ex);
  for (const ex of user || []) {
    if (ex.name?.trim() && ex.selector?.trim()) byName.set(ex.name.trim(), ex);
  }
  return [...byName.values()];
}
