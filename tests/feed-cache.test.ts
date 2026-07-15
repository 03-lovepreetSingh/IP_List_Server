import { describe, it, expect } from "vitest";
import { computeEtag, toHttpDate, shouldReturn304 } from "@/lib/feed-cache";

describe("computeEtag", () => {
  it("produces a quoted sha256 hex of the body", () => {
    const etag = computeEtag("10.0.0.1\n10.0.0.2\n");
    expect(etag).toMatch(/^"[0-9a-f]{64}"$/);
  });

  it("is deterministic — same body, same ETag", () => {
    expect(computeEtag("hello\n")).toBe(computeEtag("hello\n"));
  });

  it("changes when a single byte of the body changes", () => {
    expect(computeEtag("10.0.0.1\n")).not.toBe(computeEtag("10.0.0.2\n"));
  });

  it("is sensitive to trailing newline (deterministic ordering matters)", () => {
    expect(computeEtag("a\nb\n")).not.toBe(computeEtag("a\nb"));
  });
});

describe("shouldReturn304 — If-None-Match", () => {
  const cache = { etag: '"abc123"', lastModified: toHttpDate(new Date("2026-01-01T00:00:00Z")) };

  it("returns 304 on exact ETag match", () => {
    expect(shouldReturn304({ ifNoneMatch: '"abc123"' }, cache)).toBe(true);
  });

  it("returns 304 on wildcard If-None-Match", () => {
    expect(shouldReturn304({ ifNoneMatch: "*" }, cache)).toBe(true);
  });

  it("returns 304 when ETag is one of a comma-separated list", () => {
    expect(shouldReturn304({ ifNoneMatch: '"zzz", "abc123"' }, cache)).toBe(true);
  });

  it("does NOT return 304 when ETag differs", () => {
    expect(shouldReturn304({ ifNoneMatch: '"different"' }, cache)).toBe(false);
  });

  it("If-None-Match takes precedence over If-Modified-Since", () => {
    // ETag mismatch but IMS would say fresh — If-None-Match wins, no 304.
    expect(
      shouldReturn304(
        { ifNoneMatch: '"wrong"', ifModifiedSince: toHttpDate(new Date("2030-01-01T00:00:00Z")) },
        cache
      )
    ).toBe(false);
  });
});

describe("shouldReturn304 — If-Modified-Since", () => {
  const lm = new Date("2026-01-01T00:00:00Z");
  const cache = { etag: '"abc"', lastModified: toHttpDate(lm) };

  it("returns 304 when client copy is newer than Last-Modified", () => {
    expect(
      shouldReturn304({ ifModifiedSince: toHttpDate(new Date("2026-06-01T00:00:00Z")) }, cache)
    ).toBe(true);
  });

  it("returns 304 when client copy equals Last-Modified", () => {
    expect(
      shouldReturn304({ ifModifiedSince: toHttpDate(new Date("2026-01-01T00:00:00Z")) }, cache)
    ).toBe(true);
  });

  it("does NOT return 304 when resource is newer than client copy", () => {
    expect(
      shouldReturn304({ ifModifiedSince: toHttpDate(new Date("2025-01-01T00:00:00Z")) }, cache)
    ).toBe(false);
  });

  it("returns false (no 304) when neither header is present", () => {
    expect(shouldReturn304({}, cache)).toBe(false);
  });

  it("returns false on a garbage If-Modified-Since date", () => {
    expect(shouldReturn304({ ifModifiedSince: "not-a-date" }, cache)).toBe(false);
  });
});

describe("toHttpDate", () => {
  it("produces an RFC 7231 UTC string", () => {
    const d = toHttpDate(new Date("2026-01-01T00:00:00Z"));
    expect(d).toMatch(/GMT$/);
    expect(Date.parse(d)).toBe(Date.parse("2026-01-01T00:00:00Z"));
  });
});
