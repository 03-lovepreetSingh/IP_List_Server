import { describe, it, expect } from "vitest";
import {
  parseIpEntry,
  parseBulk,
  partitionBulk,
  isParsedEntry,
  type ParsedEntry,
} from "@/lib/ip";

// Convenience: parse and assert success, returning the entry.
function expectOk(raw: string): ParsedEntry {
  const r = parseIpEntry(raw);
  expect(isParsedEntry(r), `expected "${raw}" to parse OK, got: ${JSON.stringify(r)}`).toBe(true);
  return r as ParsedEntry;
}

function expectErr(raw: string, reasonContains?: string) {
  const r = parseIpEntry(raw);
  expect(isParsedEntry(r), `expected "${raw}" to be rejected`).toBe(false);
  if (reasonContains) {
    expect((r as { reason: string }).reason).toContain(reasonContains);
  }
}

describe("parseIpEntry — single addresses", () => {
  it("accepts a plain IPv4", () => {
    const e = expectOk("10.0.0.5");
    expect(e).toEqual({ value: "10.0.0.5", kind: "IP", family: 4 });
  });

  it("accepts a plain IPv6 and lowercases it", () => {
    const e = expectOk("2001:DB8::1");
    expect(e).toEqual({ value: "2001:db8::1", kind: "IP", family: 6 });
  });

  it("trims surrounding whitespace", () => {
    const e = expectOk("   10.0.0.5   ");
    expect(e.value).toBe("10.0.0.5");
  });

  it("rejects empty input", () => {
    expectErr("   ", "empty");
    expectErr("", "empty");
  });

  it("rejects garbage", () => {
    expectErr("not-an-ip");
    expectErr("999.999.999.999");
  });
});

describe("parseIpEntry — CIDR", () => {
  it("accepts a clean IPv4 CIDR", () => {
    const e = expectOk("10.0.0.0/24");
    expect(e).toEqual({ value: "10.0.0.0/24", kind: "CIDR", family: 4 });
  });

  it("accepts a clean IPv6 CIDR", () => {
    const e = expectOk("2001:db8::/32");
    expect(e).toEqual({ value: "2001:db8::/32", kind: "CIDR", family: 6 });
  });

  it("AUTO-MASKS host bits on IPv4 (10.0.0.5/24 -> 10.0.0.0/24)", () => {
    const e = expectOk("10.0.0.5/24");
    expect(e.value).toBe("10.0.0.0/24");
    expect(e.kind).toBe("CIDR");
  });

  it("AUTO-MASKS host bits on IPv6", () => {
    const e = expectOk("2001:db8::1/64");
    // ::1 with /64 host bits cleared -> ::
    expect(e.value).toBe("2001:db8::/64");
  });

  it("leaves /32 IPv4 unchanged (no host bits)", () => {
    expectOk("10.0.0.5/32");
    const e = expectOk("10.0.0.5/32");
    expect(e.value).toBe("10.0.0.5/32");
  });

  it("rejects out-of-range IPv4 prefix", () => {
    expectErr("10.0.0.0/33", "0–32");
    expectErr("10.0.0.0/-1", "0–32");
  });

  it("rejects out-of-range IPv6 prefix", () => {
    expectErr("2001:db8::/129", "0–128");
  });

  it("rejects non-numeric prefix", () => {
    expectErr("10.0.0.0/abc", "integer");
  });

  it("rejects CIDR whose address part is not an IP", () => {
    expectErr("not-an-ip/24");
  });
});

describe("parseIpEntry — ranges", () => {
  it("accepts a clean IPv4 range", () => {
    const e = expectOk("10.0.0.1-10.0.0.50");
    expect(e).toEqual({ value: "10.0.0.1-10.0.0.50", kind: "RANGE", family: 4 });
  });

  it("strips inner spaces", () => {
    const e = expectOk("10.0.0.1 - 10.0.0.50");
    expect(e.value).toBe("10.0.0.1-10.0.0.50");
  });

  it("accepts a single-host range (start == end)", () => {
    const e = expectOk("10.0.0.5-10.0.0.5");
    expect(e.value).toBe("10.0.0.5-10.0.0.5");
    expect(e.kind).toBe("RANGE");
  });

  it("REJECTS a reversed range (start > end)", () => {
    expectErr("10.0.0.50-10.0.0.1", "greater than end");
  });

  it("REJECTS an IPv6 range (v4 only)", () => {
    expectErr("2001:db8::1-2001:db8::2", "only supported for IPv4");
  });

  it("REJECTS a mixed-family range", () => {
    expectErr("10.0.0.1-2001:db8::1", "only supported for IPv4");
  });

  it("rejects a range whose endpoint contains a CIDR (routed to CIDR parser)", () => {
    // A "/" always routes to the CIDR parser, so this is a malformed CIDR,
    // not a range. Either way, it is rejected.
    expectErr("10.0.0.0/24-10.0.0.50");
  });

  it("rejects nested ranges (endpoint itself looks like a range)", () => {
    expectErr("10.0.0.1-10.0.0.2-10.0.0.3", "bare IPs");
  });

  it("rejects a malformed range (missing end)", () => {
    expectErr("10.0.0.1-", "start-end");
  });
});

describe("parseIpEntry — normalisation consistency", () => {
  it("produces identical output for masked CIDR whether or not host bits set", () => {
    const clean = expectOk("10.0.0.0/24");
    const masked = expectOk("10.0.0.99/24");
    expect(clean.value).toBe(masked.value);
  });

  it("lowercases IPv6 in CIDR too", () => {
    const e = expectOk("2001:DB8:ABCD::/48");
    expect(e.value).toBe("2001:db8:abcd::/48");
  });
});

describe("parseBulk + partitionBulk", () => {
  it("splits on newlines and commas", () => {
    const results = parseBulk("10.0.0.1\n10.0.0.2,10.0.0.3");
    expect(results).toHaveLength(3);
  });

  it("ignores blank lines and # comments", () => {
    const results = parseBulk("# header\n\n10.0.0.1\n");
    expect(results).toHaveLength(1);
    expect(results[0]!.raw).toBe("10.0.0.1");
  });

  it("partitions valid vs skipped with reasons", () => {
    // 10.0.0.0/24 and 10.0.0.5/24 both normalise to 10.0.0.0/24 -> de-duped.
    const results = parseBulk("10.0.0.1\n999.999.999.999\n10.0.0.0/24\n10.0.0.5/24");
    const { valid, skipped } = partitionBulk(results);
    expect(valid).toHaveLength(2); // 10.0.0.1, 10.0.0.0/24 (10.0.0.5/24 masked->dup)
    expect(valid.map((v) => v.value)).toEqual(
      expect.arrayContaining(["10.0.0.1", "10.0.0.0/24"])
    );
    expect(skipped).toHaveLength(2); // bad IP + masked duplicate
    expect(skipped.some((s) => /valid IPv4 or IPv6/.test(s.reason))).toBe(true);
    expect(skipped.some((s) => /duplicate/.test(s.reason))).toBe(true);
  });

  it("de-duplicates within the import", () => {
    const results = parseBulk("10.0.0.0/24\n10.0.0.99/24"); // both mask to 10.0.0.0/24
    const { valid, skipped } = partitionBulk(results);
    expect(valid).toHaveLength(1);
    expect(skipped).toHaveLength(1);
    expect(skipped[0]!.reason).toMatch(/duplicate/);
  });

  it("reports the original (pre-normalisation) value in skips", () => {
    const results = parseBulk("10.0.0.50-10.0.0.1");
    const { skipped } = partitionBulk(results);
    expect(skipped[0]!.value).toBe("10.0.0.50-10.0.0.1");
  });
});
