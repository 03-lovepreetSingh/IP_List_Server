// NOTE: deliberately no `node:` imports. This module is imported by the
// client bundle (the GUI live preview) AND the server (API routes), so it
// must be dependency-free and browser-safe. IP validity is checked with
// pure regex/logic below instead of `node:net`.

/**
 * # IP entry parse / normalise / validate
 *
 * THE single source of truth for what an IP feed entry means.
 * Imported by both the API routes and the GUI live preview, so the two
 * surfaces can never disagree on whether "10.0.0.5/24" is valid.
 *
 * ## Accepted shapes (the firewall contract — exactly three)
 *   1. Single address  "10.0.0.5"        | "2001:db8::1"
 *   2. CIDR network     "10.0.0.0/24"     | "2001:db8::/32"
 *   3. Inclusive range  "10.0.0.1-10.0.0.50"   (v4 only; v6 ranges rejected)
 *
 * ## Normalisation (on write)
 *   - trim outer whitespace
 *   - lowercase IPv6 (canonical form)
 *   - strip a range's inner spaces  ("10.0.0.1 - 10.0.0.50" -> "10.0.0.1-10.0.0.50")
 *   - CIDR host bits are AUTO-MASKED to the network address (e.g. 10.0.0.5/24 -> 10.0.0.0/24)
 *
 * ## Rejections (return ParseError, never throw)
 *   - unparseable / empty
 *   - reversed range (start > end)
 *   - mixed-family range (v4 start, v6 end or vice-versa)
 *   - IPv6 range (unsupported — v4 only)
 *   - range endpoint that isn't a bare IP (no CIDR/range nesting)
 */

export const FAMILY_V4 = 4 as const;
export const FAMILY_V6 = 6 as const;
export type Family = typeof FAMILY_V4 | typeof FAMILY_V6;

export const KIND_IP = "IP" as const;
export const KIND_CIDR = "CIDR" as const;
export const KIND_RANGE = "RANGE" as const;
export type Kind = typeof KIND_IP | typeof KIND_CIDR | typeof KIND_RANGE;

/** A successfully parsed, normalised entry ready to store. */
export interface ParsedEntry {
  /** Canonical text form, exactly what the firewall will receive. */
  value: string;
  kind: Kind;
  family: Family;
}

/** A rejection with a human-readable reason. Never thrown — returned. */
export interface ParseError {
  /** The (possibly un-normalised) input that was rejected. */
  input: string;
  /** Short, actionable reason. Safe to show to an operator. */
  reason: string;
}

export type ParseResult = ParsedEntry | ParseError;

/** Type guard: did parsing succeed? */
export function isParsedEntry(r: ParseResult): r is ParsedEntry {
  return (r as ParsedEntry).value !== undefined;
}

// ---------------------------------------------------------------------------
// Pure-JS IP validity checks (no `node:net` — must run in the browser too)
// ---------------------------------------------------------------------------

const V4_OCTET = "(25[0-5]|2[0-4]\\d|1\\d\\d|[1-9]?\\d)";
const V4_REGEX = new RegExp(`^${V4_OCTET}(\\.${V4_OCTET}){3}$`);

/**
 * Validate an IPv4 dotted-quad. Rejects leading zeros (e.g. "010.0.0.1"),
 * out-of-range octets, and any non-4-group form. Matches `node:net.isIPv4`.
 */
export function isIPv4(s: string): boolean {
  if (!V4_REGEX.test(s)) return false;
  // Each octet 0–255 is already guaranteed by the regex alternation; double-check
  // the no-leading-zero rule only for clarity (regex permits "0" alone).
  const parts = s.split(".");
  return parts.every((p) => {
    if (p.length > 1 && p.startsWith("0")) return false; // reject "010"
    const n = Number(p);
    return n >= 0 && n <= 255;
  });
}

/**
 * Validate an IPv6 address, including `::` shorthand and IPv4-mapped tails.
 * Mirrors `node:net.isIPv6` semantics. Does NOT enforce RFC 5952
 * canonicalisation (compression) — that is handled in bigIntToV6 on output.
 */
export function isIPv6(s: string): boolean {
  const v = s.trim();
  if (!v) return false;

  // IPv4-mapped tail (::ffff:1.2.3.4) — validate the trailing v4 part.
  const lastColon = v.lastIndexOf(":");
  const tail = v.slice(lastColon + 1);
  if (tail.includes(".") && !isIPv4(tail)) return false;

  // Must contain at least one colon; at most one "::".
  if (!v.includes(":")) return false;
  const doubleColons = v.match(/::/g);
  if (doubleColons && doubleColons.length > 1) return false;

  // Split off an optional v4 tail for group counting.
  let head = v;
  let v4Groups = 0;
  if (tail.includes(".") && isIPv4(tail)) {
    head = v.slice(0, lastColon + 1);
    v4Groups = 2; // a v4 tail counts as two 16-bit groups
  }

  // Expand "::" to count groups.
  const [h, t = ""] = head.split("::");
  const headGroups = h ? h.split(":") : [];
  const tailGroups = t ? t.split(":") : [];

  // Each group must be 1–4 hex digits.
  const allGroups = [...headGroups, ...tailGroups];
  if (allGroups.length > 0 && !allGroups.every((g) => /^[0-9a-fA-F]{1,4}$/.test(g))) {
    return false;
  }

  const groupCount = allGroups.length + v4Groups;
  if (doubleColons) {
    // With "::", total must be <= 8.
    return groupCount <= 8;
  }
  // Without "::", exactly 8 groups (including v4 tail as 2).
  return groupCount === 8;
}

// ---------------------------------------------------------------------------
// Low-level BigInt address helpers
// ---------------------------------------------------------------------------

const V4_BITS = 32n;
const V6_BITS = 128n;

/** Convert a validated single IPv4/IPv6 string to a BigInt. Caller guarantees validity. */
function ipToBigInt(ip: string, family: Family): bigint {
  if (family === FAMILY_V4) {
    const parts = ip.split(".");
    let n = 0n;
    for (let i = 0; i < 4; i++) {
      n = (n << 8n) + BigInt(parts[i] ?? 0);
    }
    return n;
  }
  // IPv6: expand to 8 groups, then pack. Defer to a stable formatter.
  const expanded = expandV6(ip);
  const groups = expanded.split(":");
  let n = 0n;
  for (let i = 0; i < 8; i++) {
    n = (n << 16n) + BigInt(parseInt(groups[i] ?? "0", 16));
  }
  return n;
}

/** Expand an IPv6 string into 8 lowercase hex groups (no :: shorthand). */
function expandV6(ip: string): string {
  // Handle IPv4-mapped (::ffff:1.2.3.4) by converting the trailing v4 part.
  let v = ip.toLowerCase();
  const lastColon = v.lastIndexOf(":");
  const maybeV4 = v.slice(lastColon + 1);
  if (maybeV4.includes(".") && isIPv4(maybeV4)) {
    const parts = maybeV4.split(".").map((p) => Number(p));
    const hex1 = ((parts[0] ?? 0) << 8 | (parts[1] ?? 0)).toString(16).padStart(4, "0");
    const hex2 = ((parts[2] ?? 0) << 8 | (parts[3] ?? 0)).toString(16).padStart(4, "0");
    v = v.slice(0, lastColon + 1) + hex1 + ":" + hex2;
  }

  // Expand :: into the right number of zero groups.
  const [head, tail = ""] = v.split("::");
  const headGroups = head ? head.split(":") : [];
  const tailGroups = tail ? tail.split(":") : [];
  const missing = 8 - (headGroups.length + tailGroups.length);
  const middle = missing > 0 ? Array(missing).fill("0") : [];
  const all = [...headGroups, ...middle, ...tailGroups];
  return all.map((g) => g.padStart(4, "0")).join(":");
}

/** Convert a BigInt back to canonical IPv4 dotted form. */
function bigIntToV4(n: bigint): string {
  const parts: string[] = [];
  for (let i = 0; i < 4; i++) {
    parts.unshift(String((n >> BigInt(i * 8)) & 0xffn));
  }
  return parts.join(".");
}

/** Convert a BigInt back to canonical (lowercase, compressed) IPv6 form. */
function bigIntToV6(n: bigint): string {
  const groups: string[] = [];
  for (let i = 0; i < 8; i++) {
    const shift = BigInt((7 - i) * 16);
    groups.push(((n >> shift) & 0xffffn).toString(16));
  }
  // Compress the longest run of zero groups into "::".
  return compressV6(groups.join(":"));
}

/** Compress the longest all-zero run in an expanded v6 string to "::". */
function compressV6(expanded: string): string {
  const groups = expanded.split(":");
  let bestStart = -1;
  let bestLen = 0;
  let curStart = -1;
  let curLen = 0;
  for (let i = 0; i < groups.length; i++) {
    if (groups[i] === "0") {
      if (curStart < 0) curStart = i;
      curLen++;
      if (curLen > bestLen) {
        bestLen = curLen;
        bestStart = curStart;
      }
    } else {
      curStart = -1;
      curLen = 0;
    }
  }
  if (bestLen < 2) return groups.map((g) => g.replace(/^0+/, "") || "0").join(":");
  const head = groups.slice(0, bestStart).map((g) => g.replace(/^0+/, "") || "0");
  const tail = groups.slice(bestStart + bestLen).map((g) => g.replace(/^0+/, "") || "0");
  return `${head.join(":")}::${tail.join(":")}`;
}

// ---------------------------------------------------------------------------
// CIDR helpers
// ---------------------------------------------------------------------------

/** Mask a BigInt address to its network prefix. */
function maskAddress(addr: bigint, prefix: bigint, bits: bigint): bigint {
  const hostBits = bits - prefix;
  if (hostBits <= 0n) return addr; // /32 or /128: no host bits
  const mask = ((1n << prefix) - 1n) << hostBits;
  return addr & mask;
}

// ---------------------------------------------------------------------------
// Main entry point
// ---------------------------------------------------------------------------

/**
 * Parse and normalise a raw input string into a canonical entry.
 *
 * Returns a ParseError (never throws) for any rejected input so callers can
 * collect per-line failures in bulk imports.
 */
export function parseIpEntry(raw: string): ParseResult {
  const input = (raw ?? "").trim();
  if (!input) {
    return { input: raw ?? "", reason: "empty value" };
  }

  // CIDR? "addr/prefix". Check BEFORE range: a CIDR prefix is numeric but a
  // value like "10.0.0.0/-1" contains a dash and would otherwise be misrouted
  // into the range branch. A genuine range never contains "/".
  if (input.includes("/")) {
    return parseCidr(input);
  }

  // Range? "start-end", possibly with spaces: "1.2.3.4 - 1.2.3.9"
  if (input.includes("-")) {
    return parseRange(input);
  }

  // Bare single address.
  return parseSingle(input);
}

function parseSingle(input: string): ParseResult {
  if (isIPv4(input)) {
    // Canonicalise so "010.0.0.5"-style octal-ish quirks don't persist.
    const value = bigIntToV4(ipToBigInt(input, FAMILY_V4));
    return { value, kind: KIND_IP, family: FAMILY_V4 };
  }
  if (isIPv6(input)) {
    const value = bigIntToV6(ipToBigInt(input, FAMILY_V6));
    return { value, kind: KIND_IP, family: FAMILY_V6 };
  }
  return { input, reason: "not a valid IPv4 or IPv6 address" };
}

function parseCidr(input: string): ParseResult {
  const slash = input.indexOf("/");
  const addrStr = input.slice(0, slash);
  const prefixStr = input.slice(slash + 1);

  // Prefix must be a bare integer (allow a leading '-' so we can report
  // "0–32" / "0–128" for negative prefixes rather than a generic parse error).
  if (!/^-?\d+$/.test(prefixStr)) {
    return { input, reason: "CIDR prefix must be an integer" };
  }
  const prefix = Number(prefixStr);

  if (isIPv4(addrStr)) {
    if (prefix < 0 || prefix > 32) {
      return { input, reason: "IPv4 CIDR prefix must be 0–32" };
    }
    const addr = ipToBigInt(addrStr, FAMILY_V4);
    const network = maskAddress(addr, BigInt(prefix), V4_BITS);
    // AUTO-MASK: host bits silently cleared, network address stored.
    const value = `${bigIntToV4(network)}/${prefix}`;
    return { value, kind: KIND_CIDR, family: FAMILY_V4 };
  }

  if (isIPv6(addrStr)) {
    if (prefix < 0 || prefix > 128) {
      return { input, reason: "IPv6 CIDR prefix must be 0–128" };
    }
    const addr = ipToBigInt(addrStr, FAMILY_V6);
    const network = maskAddress(addr, BigInt(prefix), V6_BITS);
    const value = `${bigIntToV6(network)}/${prefix}`;
    return { value, kind: KIND_CIDR, family: FAMILY_V6 };
  }

  return { input, reason: "CIDR address part is not a valid IP" };
}

function parseRange(input: string): ParseResult {
  // Split on the FIRST dash only. A v6 address can contain no dash, and
  // we reject v6 ranges entirely below, so this is safe for v4 ranges.
  const dash = input.indexOf("-");
  const startStr = input.slice(0, dash).trim();
  const endStr = input.slice(dash + 1).trim();

  if (!startStr || !endStr) {
    return { input, reason: "range must be 'start-end'" };
  }

  // Endpoints must be bare IPs (no CIDR/range nesting).
  if (startStr.includes("/") || endStr.includes("/") || startStr.includes("-") || endStr.includes("-")) {
    return { input, reason: "range endpoints must be bare IPs" };
  }

  const startFamily = familyOf(startStr);
  const endFamily = familyOf(endStr);

  if (startFamily === null || endFamily === null) {
    return { input, reason: "range endpoints must be valid IPs" };
  }

  // v6 ranges are unsupported (spec: v4 only).
  if (startFamily === FAMILY_V6 || endFamily === FAMILY_V6) {
    return { input, reason: "ranges are only supported for IPv4" };
  }

  // Mixed-family range (shouldn't happen post-v6 check, but guard anyway).
  if (startFamily !== endFamily) {
    return { input, reason: "range endpoints must be the same family" };
  }

  const startBig = ipToBigInt(startStr, FAMILY_V4);
  const endBig = ipToBigInt(endStr, FAMILY_V4);

  if (startBig > endBig) {
    return { input, reason: "range start is greater than end" };
  }

  // Canonical: no inner spaces, lowercase (v4 has no case).
  const value = `${bigIntToV4(startBig)}-${bigIntToV4(endBig)}`;
  return { value, kind: KIND_RANGE, family: FAMILY_V4 };
}

/** Return 4 | 6 for a bare IP string, or null if not an IP. */
function familyOf(s: string): Family | null {
  if (isIPv4(s)) return FAMILY_V4;
  if (isIPv6(s)) return FAMILY_V6;
  return null;
}

// ---------------------------------------------------------------------------
// Bulk parsing (for the bulk-import endpoint + GUI preview)
// ---------------------------------------------------------------------------

export interface BulkLineResult {
  /** 1-based line number within the submitted blob. */
  line: number;
  /** Trimmed raw text of the line (may be empty / a comment). */
  raw: string;
  result: ParseResult;
}

export interface BulkParseOutcome {
  valid: ParsedEntry[];
  skipped: { line: number; value: string; reason: string }[];
}

/**
 * Parse a free-form blob (newline OR comma separated) into valid entries
 * plus a per-line skip report. Lines that are empty or start with `#` are
 * ignored (not counted as skipped).
 *
 * De-duplicates within the blob by canonical value (first occurrence wins),
 * because storing duplicates would just hit the unique constraint anyway.
 */
export function parseBulk(blob: string): BulkLineResult[] {
  // Split on newlines and commas so users can paste either format.
  const tokens = blob.split(/[\r\n,]+/);
  const results: BulkLineResult[] = [];
  let line = 0;
  for (const token of tokens) {
    line++;
    const trimmed = token.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    results.push({ line, raw: trimmed, result: parseIpEntry(trimmed) });
  }
  return results;
}

/** Partition a bulk-parse result into valid entries and skips, de-duped. */
export function partitionBulk(results: BulkLineResult[]): BulkParseOutcome {
  const valid: ParsedEntry[] = [];
  const seen = new Set<string>();
  const skipped: { line: number; value: string; reason: string }[] = [];

  for (const r of results) {
    if (isParsedEntry(r.result)) {
      if (seen.has(r.result.value)) {
        skipped.push({ line: r.line, value: r.raw, reason: "duplicate within import" });
        continue;
      }
      seen.add(r.result.value);
      valid.push(r.result);
    } else {
      skipped.push({ line: r.line, value: r.raw, reason: r.result.reason });
    }
  }
  return { valid, skipped };
}
