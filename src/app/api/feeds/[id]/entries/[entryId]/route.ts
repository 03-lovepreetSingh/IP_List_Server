import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { updateEntrySchema } from "@/lib/schemas";
import { json, jsonError, zodError } from "@/lib/http";
import { parseIpEntry, isParsedEntry, type Kind, type Family } from "@/lib/ip";
import { Prisma } from "@prisma/client";

export const dynamic = "force-dynamic";

// PATCH /api/feeds/[id]/entries/[entryId]
export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ id: string; entryId: string }> }
) {
  const { id, entryId } = await params;
  const parsed = updateEntrySchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return zodError(parsed.error);

  // If the value is changing, re-parse to keep kind/family/normalisation consistent.
  let normalized: { value: string; kind: Kind; family: Family } | undefined;
  if (parsed.data.value !== undefined) {
    const result = parseIpEntry(parsed.data.value);
    if (!isParsedEntry(result)) {
      return jsonError(`invalid entry: ${result.reason}`, 400, { value: parsed.data.value });
    }
    normalized = { value: result.value, kind: result.kind, family: result.family };
  }

  try {
    const updated = await prisma.ipEntry.update({
      where: { id: entryId, feedId: id },
      data: {
        ...(normalized ? { ...normalized } : {}),
        ...(parsed.data.enabled !== undefined ? { enabled: parsed.data.enabled } : {}),
        ...(parsed.data.description !== undefined
          ? { description: parsed.data.description }
          : {}),
      },
    });
    return json(updated);
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2025") {
      return jsonError("entry not found", 404);
    }
    if (typeof err === "object" && err !== null && (err as { code?: string }).code === "P2002") {
      return jsonError("entry with that value already exists in this feed", 409);
    }
    throw err;
  }
}

// DELETE /api/feeds/[id]/entries/[entryId]
export async function DELETE(
  _req: Request,
  { params }: { params: Promise<{ id: string; entryId: string }> }
) {
  const { id, entryId } = await params;
  try {
    await prisma.ipEntry.delete({ where: { id: entryId, feedId: id } });
    return NextResponse.json({ deleted: true }, { status: 200 });
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2025") {
      return jsonError("entry not found", 404);
    }
    throw err;
  }
}
