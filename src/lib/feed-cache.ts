import { createHash } from "node:crypto";

/**
 * # Feed caching helpers
 *
 * Pure functions for the feed endpoint's HTTP caching contract.
 * Extracted from the route handler so they are unit-testable without
 * a running Next.js server.
 *
 * ## Contract
 *   - ETag = strong, sha256 hex of the EXACT response body, quoted.
 *   - Last-Modified = max(updatedAt) across the feed's included entries.
 *   - If-None-Match matches ETag        -> 304.
 *   - If-Modified-Since >= Last-Modified -> 304.
 *   - Cache-Control: no-cache (revalidate, but 304 allowed).
 */

/** Compute a strong, quoted ETag from the exact response body bytes. */
export function computeEtag(body: string): string {
  const hash = createHash("sha256").update(body, "utf8").digest("hex");
  return `"${hash}"`;
}

/** Format a Date as an RFC 7231 HTTP-date (used for Last-Modified). */
export function toHttpDate(d: Date): string {
  return d.toUTCString();
}

export interface ConditionalRequest {
  ifNoneMatch?: string | null;
  ifModifiedSince?: string | null;
}

export interface CacheState {
  etag: string;
  lastModified: string; // HTTP-date string
}

/**
 * Decide whether to return 304 for a conditional request.
 *
 * RFC 7232: If-None-Match takes precedence over If-Modified-Since.
 * A matching If-None-Match (including the wildcard `*`) => 304.
 * Otherwise, If-Modified-Since >= Last-Modified => 304.
 */
export function shouldReturn304(
  req: ConditionalRequest,
  cache: CacheState
): boolean {
  const inm = req.ifNoneMatch?.trim();
  if (inm) {
    // If-None-Match can be a comma-separated list of ETags.
    const tags = inm.split(",").map((t) => t.trim());
    if (tags.includes("*")) return true;
    if (tags.includes(cache.etag)) return true;
    // 304 short-circuits here regardless of If-Modified-Since.
    return false;
  }

  const ims = req.ifModifiedSince?.trim();
  if (ims) {
    const imsTime = Date.parse(ims);
    const lmTime = Date.parse(cache.lastModified);
    if (Number.isNaN(imsTime)) return false;
    if (Number.isNaN(lmTime)) return false;
    // 304 iff the client's copy is at least as new as the resource.
    return lmTime <= imsTime;
  }

  return false;
}
