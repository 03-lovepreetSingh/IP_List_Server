import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { updateFeedSchema } from "@/lib/schemas";
import { json, jsonError, zodError } from "@/lib/http";
import { Prisma } from "@prisma/client";

export const dynamic = "force-dynamic";

// GET /api/feeds/[id]
export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const feed = await prisma.feed.findUnique({
    where: { id },
    include: { _count: { select: { entries: true } } },
  });
  if (!feed) return jsonError("feed not found", 404);
  return json(feed);
}

// PATCH /api/feeds/[id]
export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const parsed = updateFeedSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return zodError(parsed.error);

  try {
    const updated = await prisma.feed.update({
      where: { id },
      data: {
        ...(parsed.data.name !== undefined ? { name: parsed.data.name } : {}),
        ...(parsed.data.description !== undefined
          ? { description: parsed.data.description }
          : {}),
        ...(parsed.data.enabled !== undefined ? { enabled: parsed.data.enabled } : {}),
      },
      include: { _count: { select: { entries: true } } },
    });
    return json(updated);
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2025") {
      return jsonError("feed not found", 404);
    }
    throw err;
  }
}

// DELETE /api/feeds/[id] — cascades to entries.
export async function DELETE(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  try {
    await prisma.feed.delete({ where: { id } });
    return NextResponse.json({ deleted: true }, { status: 200 });
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2025") {
      return jsonError("feed not found", 404);
    }
    throw err;
  }
}
