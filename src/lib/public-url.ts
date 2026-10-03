import { lookup } from "node:dns/promises";
import { isIP } from "node:net";

const BLOCKED_HOSTS = new Set([
  "localhost",
  "localhost.localdomain",
  "metadata.google.internal",
  "metadata.internal",
]);

const resolvedHost = new Map<string, boolean>();

export class PublicUrlError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PublicUrlError";
  }
}

/** True for loopback, link-local, private, CGNAT, and IPv6 unique-local addresses. */
export function isPrivateIp(ip: string): boolean {
  let normalized = ip.toLowerCase().replace(/^\[|\]$/g, "");
  if (normalized.startsWith("::ffff:")) normalized = normalized.slice("::ffff:".length);
  if (normalized === "::1" || normalized === "::" || normalized === "0.0.0.0") return true;
  if (normalized.startsWith("fe80:") || normalized.startsWith("fc") || normalized.startsWith("fd")) {
    return true;
  }
  if (isIP(normalized) === 6) return false;

  const parts = normalized.split(".").map((part) => Number(part));
  if (parts.length !== 4 || parts.some((n) => !Number.isInteger(n) || n < 0 || n > 255)) {
    return false;
  }
  const [a, b] = parts;
  if (a === 10 || a === 127 || a === 0 || a === 255) return true;
  if (a === 169 && b === 254) return true;
  if (a === 192 && b === 168) return true;
  if (a === 172 && b >= 16 && b <= 31) return true;
  if (a === 100 && b >= 64 && b <= 127) return true;
  return false;
}

export async function assertPublicHttpUrl(raw: string): Promise<URL> {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new PublicUrlError("Invalid URL");
  }
  if (url.username || url.password) {
    throw new PublicUrlError("URL must not include credentials");
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new PublicUrlError("URL must be http or https");
  }

  const host = url.hostname.toLowerCase().replace(/\.$/, "").replace(/^\[|\]$/g, "");
  if (
    !host ||
    BLOCKED_HOSTS.has(host) ||
    host.endsWith(".localhost") ||
    host.endsWith(".local")
  ) {
    throw new PublicUrlError("Local or private hosts are not allowed");
  }

  if (isIP(host)) {
    if (isPrivateIp(host)) throw new PublicUrlError("Private network addresses are not allowed");
    return url;
  }

  const cached = resolvedHost.get(host);
  if (cached === false) throw new PublicUrlError("Host resolves to a private network address");
  if (cached === true) return url;

  let records: { address: string }[];
  try {
    records = await lookup(host, { all: true, verbatim: true });
  } catch {
    throw new PublicUrlError(`Could not resolve host: ${host}`);
  }
  const blocked = records.length === 0 || records.some((record) => isPrivateIp(record.address));
  resolvedHost.set(host, !blocked);
  if (blocked) throw new PublicUrlError("Host resolves to a private network address");
  return url;
}
