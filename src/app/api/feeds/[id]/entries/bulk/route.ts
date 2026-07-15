import { prisma } from "@/lib/prisma";
import { bulkImportSchema } from "@/lib/schemas";
import { json, jsonError, zodError } from "@/lib/http";
import { parseBulk, partitionBulk } from "@/lib/ip";
import { Prisma } from "@prisma/client";

export const dynamic = "force-dynamic";

/** Hard cap on a single bulk import (distinct from the per-feed 10k cap). */
const MAX_BULK_LINES = 10_000;

/**
 * POST /api/feeds/[id]/entries/bulk
 *
 * Accepts { blob: "newline/comma separated entries" }, validates every line,
 * and inserts the valid ones in a SINGLE TRANSACTION (all-or-nothing).
 *
 * Returns { added, skipped: [{line, value, reason}] }.
 *
 * All-or-nothing semantics: if the transaction fails (e.g. a duplicate that
 * passed the in-blob de-dup but already exists in the DB), NOTHING is added
 * and the full skip report is returned.
 */
export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const parsed = bulkImportSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return zodError(parsed.error);

  const feedExists = await prisma.feed.findUnique({ where: { id }, select: { id: true } });
  if (!feedExists) return jsonError("feed not found", 404);

  // Line-cap check before parsing a huge blob.
  const lineCount = parsed.data.blob.split(/[\r\n,]+/).length;
  if (lineCount > MAX_BULK_LINES) {
    return jsonError(`bulk import exceeds ${MAX_BULK_LINES} lines`, 413);
  }

  const results = parseBulk(parsed.data.blob);
  const { valid, skipped } = partitionBulk(results);

  if (valid.length === 0) {
    // Nothing valid to insert — report skips, no transaction needed.
    return json({ added: 0, skipped });
  }

  // All-or-nothing insert. If ANY row collides with an existing DB entry,
  // the whole transaction rolls back and we report it.
  try {
    const created = await prisma.$transaction(
      valid.map((entry) =>
        prisma.ipEntry.create({
          data: {
            feedId: id,
            value: entry.value,
            kind: entry.kind,
            family: entry.family,
            enabled: true,
          },
          select: { id: true, value: true, kind: true, family: true },
        })
      )
    );

    return json({ added: created.length, skipped });
  } catch (err) {
    // A duplicate in the DB causes P2002. Roll back, report which value.
    if (
      err instanceof Prisma.PrismaClientKnownRequestError &&
      err.code === "P2002"
    ) {
      const meta = err.meta as { target?: string[] } | undefined;
      const target = meta?.target?.join(", ") ?? "value";
      return jsonError(
        `bulk import rolled back: an entry already exists in this feed (conflict on ${target}). No entries were added.`,
        409,
        { skipped }
      );
    }
    throw err;
  }
}
