import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { createFeedSchema } from "@/lib/schemas";
import { json, zodError } from "@/lib/http";

export const dynamic = "force-dynamic";

// GET /api/feeds — list all feeds with their entry counts.
export async function GET() {
  const feeds = await prisma.feed.findMany({
    orderBy: { createdAt: "desc" },
    include: {
      _count: { select: { entries: true } },
    },
  });
  return json(feeds);
}

// POST /api/feeds — create a feed.
export async function POST(req: Request) {
  const parsed = createFeedSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return zodError(parsed.error);
  const { slug, name, description, token, enabled } = parsed.data;

  try {
    const created = await prisma.feed.create({
      data: { slug, name, description: description ?? null, token: token ?? null, enabled },
      include: { _count: { select: { entries: true } } },
    });
    return json(created, 201);
  } catch (err) {
    if (isUniqueViolation(err)) {
      return NextResponse.json(
        { error: `slug "${slug}" already exists` },
        { status: 409 }
      );
    }
    throw err;
  }
}

/** Prisma P2002 = unique-constraint violation. */
function isUniqueViolation(err: unknown): boolean {
  if (typeof err !== "object" || err === null) return false;
  return (err as { code?: string }).code === "P2002";
}
