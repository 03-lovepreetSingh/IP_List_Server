import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { serializeFeedBody, isValidFamilyParam } from "@/lib/feed-serialize";
import { computeEtag, toHttpDate, shouldReturn304 } from "@/lib/feed-cache";
import { constantTimeEqual } from "@/lib/crypto";

// Fully dynamic — never statically cached, no ISR. The firewall must always
// see the current DB state on a revalidation request.
export const dynamic = "force-dynamic";
export const revalidate = 0;

/** Hard cap on entries per feed. Past this, return an error (never truncate). */
const MAX_FEED_ENTRIES = 10_000;

const PLAIN_TEXT = "text/plain; charset=utf-8" as const;

function plainError(message: string, status: number) {
  return new NextResponse(message + "\n", {
    status,
    headers: { "Content-Type": PLAIN_TEXT },
  });
}

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ slug: string }> }
) {
  const { slug } = await params;
  const url = new URL(req.url);
  const familyParam = url.searchParams.get("family");

  // Unknown slug / disabled feed -> 404 plain text. Never leak existence.
  const feed = await prisma.feed.findUnique({
    where: { slug },
    select: { id: true, name: true, token: true, enabled: true },
  });

  if (!feed || !feed.enabled) {
    return plainError("not found", 404);
  }

  // Bearer-token auth (constant-time compare). Public feed (null token) is open.
  if (feed.token !== null) {
    const auth = req.headers.get("authorization") ?? "";
    const expected = `Bearer ${feed.token}`;
    // Always compare, even if the header is missing, to keep timing constant.
    const provided = auth.startsWith("Bearer ") ? auth : `Bearer ${auth}`;
    if (!constantTimeEqual(provided, expected)) {
      return plainError("unauthorized", 401);
    }
  }

  // Invalid ?family= value is a client error, not "both families".
  if (!isValidFamilyParam(familyParam)) {
    return plainError("invalid family parameter (use 4 or 6)", 400);
  }
  const familyFilter =
    familyParam === "4" ? 4 : familyParam === "6" ? 6 : undefined;

  // Count first — enforce the cap BEFORE serializing a huge list.
  const totalCount = await prisma.ipEntry.count({
    where: { feedId: feed.id, enabled: true },
  });
  if (totalCount > MAX_FEED_ENTRIES) {
    return plainError(
      `feed exceeds ${MAX_FEED_ENTRIES} entries (${totalCount}); refusing to emit a partial list`,
      500
    );
  }

  // Fetch enabled entries, optionally family-filtered.
  const entries = await prisma.ipEntry.findMany({
    where: {
      feedId: feed.id,
      enabled: true,
      ...(familyFilter ? { family: familyFilter } : {}),
    },
    select: { value: true, family: true, updatedAt: true },
  });

  // Deterministic timestamp from the data: the max updatedAt across included
  // entries. For an empty feed, use the epoch so the body is still stable
  // across requests (an empty list must produce a stable ETag too). This is
  // shared between the body's `# generated:` header AND Last-Modified, and it
  // is what makes the ETag reproducible so conditional 304s actually work.
  const maxUpdatedAt =
    entries.length > 0
      ? new Date(Math.max(...entries.map((e) => e.updatedAt.getTime())))
      : new Date(0);
  const body = serializeFeedBody(feed.name, entries, maxUpdatedAt);

  const etag = computeEtag(body);
  const lastModified = toHttpDate(maxUpdatedAt);

  // Conditional request handling -> 304 with empty body + same ETag.
  const cache = { etag, lastModified };
  if (
    shouldReturn304(
      {
        ifNoneMatch: req.headers.get("if-none-match"),
        ifModifiedSince: req.headers.get("if-modified-since"),
      },
      cache
    )
  ) {
    return new NextResponse(null, {
      status: 304,
      headers: {
        ETag: etag,
        "Last-Modified": lastModified,
        "Cache-Control": "no-cache",
      },
    });
  }

  return new NextResponse(body, {
    status: 200,
    headers: {
      "Content-Type": PLAIN_TEXT,
      ETag: etag,
      "Last-Modified": lastModified,
      // no-cache = must revalidate, but 304s are allowed (saves bandwidth).
      "Cache-Control": "no-cache",
      // Defensive: prevent any intermediary from "fixing" the body.
      "X-Content-Type-Options": "nosniff",
    },
  });
}
