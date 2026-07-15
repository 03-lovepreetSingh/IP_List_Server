import { NextResponse } from "next/server";
import { ZodError } from "zod";

/** Standard JSON success (200). */
export function json(body: unknown, status = 200) {
  return NextResponse.json(body, { status });
}

/** Standard JSON error with a message and status. */
export function jsonError(message: string, status: number, details?: unknown) {
  return NextResponse.json({ error: message, ...(details ? { details } : {}) }, { status });
}

/** Turn a Zod failure into a 400 with field-level details. */
export function zodError(e: ZodError) {
  return jsonError("validation failed", 400, e.issues);
}
