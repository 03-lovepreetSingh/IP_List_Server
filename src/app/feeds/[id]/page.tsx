import { prisma } from "@/lib/prisma";
import { notFound } from "next/navigation";
import Link from "next/link";
import { EntryManager } from "@/components/entry-manager";

export const dynamic = "force-dynamic";

export default async function FeedDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;

  const feed = await prisma.feed.findUnique({
    where: { id },
    include: { _count: { select: { entries: true } } },
  });
  if (!feed) notFound();

  const entries = await prisma.ipEntry.findMany({
    where: { feedId: id },
    orderBy: [{ family: "asc" }, { value: "asc" }],
  });

  const baseUrl = process.env.NEXT_PUBLIC_BASE_URL ?? "";
  const fullUrl = `${baseUrl.replace(/\/$/, "")}/api/feed/${feed.slug}`;

  return (
    <main className="min-h-screen bg-muted/30">
      <header className="border-b bg-background">
        <div className="mx-auto max-w-6xl px-6 py-4">
          <Link href="/" className="text-sm text-muted-foreground hover:underline">
            ← Back to feeds
          </Link>
          <h1 className="mt-1 text-xl font-semibold tracking-tight">{feed.name}</h1>
          <p className="text-sm text-muted-foreground">
            <code className="font-mono">{feed.slug}</code> · {feed._count.entries} entries
          </p>
        </div>
      </header>

      <div className="mx-auto max-w-6xl px-6 py-8">
        <EntryManager
          feed={{
            id: feed.id,
            slug: feed.slug,
            name: feed.name,
            description: feed.description,
            token: feed.token,
            enabled: feed.enabled,
            fullUrl,
          }}
          initialEntries={entries.map((e) => ({
            id: e.id,
            value: e.value,
            kind: e.kind,
            family: (e.family === 6 ? 6 : 4) as 4 | 6,
            enabled: e.enabled,
            description: e.description,
            updatedAt: e.updatedAt.toISOString(),
          }))}
        />
      </div>
    </main>
  );
}
