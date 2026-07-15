import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { jsonError } from "@/lib/http";
import { generateToken } from "@/lib/crypto";
import { Prisma } from "@prisma/client";

export const dynamic = "force-dynamic";

/**
 * POST /api/feeds/[id]/rotate-token
 *
 * Generates a fresh bearer token, replacing any existing one. A feed with
 * a null token (public) can be secured by rotating; pass `{"enabled": false}`
 * in the body to clear the token back to public.
 */
export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const body = await req.json().catch(() => ({}));
  const makePublic = body?.public === true;

  try {
    const updated = await prisma.feed.update({
      where: { id },
      data: makePublic ? { token: null } : { token: generateToken() },
      select: { id: true, slug: true, token: true },
    });
    return NextResponse.json(updated, { status: 200 });
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2025") {
      return jsonError("feed not found", 404);
    }
    throw err;
  }
}
