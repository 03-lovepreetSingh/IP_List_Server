import { prisma } from "@/lib/prisma";
import { FeedListClient } from "@/components/feed-list-client";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import Link from "next/link";
import { Button } from "@/components/ui/button";

export const dynamic = "force-dynamic";

export default async function HomePage() {
  const feeds = await prisma.feed.findMany({
    orderBy: { createdAt: "desc" },
    include: { _count: { select: { entries: true } } },
  });

  return (
    <main className="min-h-screen bg-muted/30">
      <header className="border-b bg-background">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-6 py-4">
          <div>
            <h1 className="text-xl font-semibold tracking-tight">IP Feed Server</h1>
            <p className="text-sm text-muted-foreground">
              Plain-text IP feeds for nftables / External Dynamic List consumption
            </p>
          </div>
          <Button asChild>
            <Link href="/feeds/new">New feed</Link>
          </Button>
        </div>
      </header>

      <div className="mx-auto max-w-6xl px-6 py-8">
        {feeds.length === 0 ? (
          <Card>
            <CardHeader>
              <CardTitle>No feeds yet</CardTitle>
              <CardDescription>
                Create your first feed to get a pollable plain-text URL.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <Button asChild>
                <Link href="/feeds/new">Create a feed</Link>
              </Button>
            </CardContent>
          </Card>
        ) : (
          <FeedListClient initialFeeds={feeds} />
        )}
      </div>
    </main>
  );
}
