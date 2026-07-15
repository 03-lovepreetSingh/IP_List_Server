import { prisma } from "@/lib/prisma";
import { createEntrySchema, listEntriesQuerySchema } from "@/lib/schemas";
import { json, jsonError, zodError } from "@/lib/http";
import { parseIpEntry, isParsedEntry } from "@/lib/ip";

export const dynamic = "force-dynamic";

// GET /api/feeds/[id]/entries — list entries with optional filters.
export async function GET(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const url = new URL(req.url);

  // Verify the feed exists (404 before filtering).
  const feedExists = await prisma.feed.findUnique({ where: { id }, select: { id: true } });
  if (!feedExists) return jsonError("feed not found", 404);

  const queryParsed = listEntriesQuerySchema.safeParse({
    family: url.searchParams.get("family") ?? undefined,
    kind: url.searchParams.get("kind") ?? undefined,
    enabled: url.searchParams.get("enabled") ?? undefined,
    search: url.searchParams.get("search") ?? undefined,
  });
  if (!queryParsed.success) return zodError(queryParsed.error);

  const { family, kind, enabled, search } = queryParsed.data;

  const entries = await prisma.ipEntry.findMany({
    where: {
      feedId: id,
      ...(family ? { family: Number(family) } : {}),
      ...(kind ? { kind } : {}),
      ...(enabled !== undefined ? { enabled: enabled === "true" } : {}),
      ...(search ? { value: { contains: search, mode: "insensitive" } } : {}),
    },
    orderBy: [{ family: "asc" }, { value: "asc" }],
  });

  return json(entries);
}

// POST /api/feeds/[id]/entries — add a single entry.
export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const parsed = createEntrySchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return zodError(parsed.error);

  const feedExists = await prisma.feed.findUnique({ where: { id }, select: { id: true } });
  if (!feedExists) return jsonError("feed not found", 404);

  // Server-side canonical parse: derive kind + family, normalise, reject bad input.
  const result = parseIpEntry(parsed.data.value);
  if (!isParsedEntry(result)) {
    return jsonError(`invalid entry: ${result.reason}`, 400, { value: parsed.data.value });
  }

  try {
    const created = await prisma.ipEntry.create({
      data: {
        feedId: id,
        value: result.value,
        kind: result.kind,
        family: result.family,
        enabled: parsed.data.enabled,
        description: parsed.data.description ?? null,
      },
    });
    return json(created, 201);
  } catch (err) {
    // Duplicate (feedId, value) -> 409 with the canonical value.
    if (typeof err === "object" && err !== null && (err as { code?: string }).code === "P2002") {
      return jsonError(`entry "${result.value}" already exists in this feed`, 409);
    }
    throw err;
  }
}
