import { timingSafeEqual, randomBytes } from "node:crypto";

/**
 * Constant-time string comparison.
 *
 * Used to compare bearer tokens so an attacker cannot time-distinguish
 * how many leading bytes match. Both strings are hashed first so the
 * comparison length is fixed regardless of input length (avoids leaking
 * the token length via timing).
 *
 * Returns true iff the two strings are byte-equal.
 */
export function constantTimeEqual(a: string, b: string): boolean {
  const bufA = Buffer.from(a, "utf8");
  const bufB = Buffer.from(b, "utf8");
  if (bufA.length !== bufB.length) {
    // Still do a comparison to keep timing roughly constant; discard result.
    timingSafeEqual(bufA, bufA);
    return false;
  }
  return timingSafeEqual(bufA, bufB);
}

/** Generate a random opaque bearer token (URL-safe, 32 bytes of entropy). */
export function generateToken(): string {
  return randomBytes(32).toString("base64url");
}
