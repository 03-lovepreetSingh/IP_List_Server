"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { api, feedUrl } from "@/lib/api-client";
import { CopyButton } from "@/components/copy-button";
import { FeedCardIpPanel } from "@/components/feed-card-ip-panel";

type Feed = {
  id: string;
  slug: string;
  name: string;
  description: string | null;
  token: string | null;
  enabled: boolean;
  createdAt: Date;
  _count: { entries: number };
};

export function FeedListClient({ initialFeeds }: { initialFeeds: Feed[] }) {
  const [feeds, setFeeds] = useState(initialFeeds);
  const [, startTransition] = useTransition();

  async function toggleEnabled(feed: Feed, enabled: boolean) {
    // Optimistic update.
    setFeeds((prev) =>
      prev.map((f) => (f.id === feed.id ? { ...f, enabled } : f))
    );
    try {
      await api.patch(`/api/feeds/${feed.id}`, { enabled });
    } catch {
      // Revert on failure.
      setFeeds((prev) =>
        prev.map((f) => (f.id === feed.id ? { ...f, enabled: !enabled } : f))
      );
    }
  }

  return (
    <div className="space-y-4">
      {feeds.map((feed) => {
        const url = feedUrl(feed.slug);
        const curl = feed.token
          ? `curl -sS -H "Authorization: Bearer ${feed.token}" "${url}"`
          : `curl -sS "${url}"`;
        return (
          <Card key={feed.id}>
            <CardContent className="p-5">
              <div className="flex flex-wrap items-start justify-between gap-4">
                <div className="space-y-1">
                  <div className="flex items-center gap-2">
                    <Link
                      href={`/feeds/${feed.id}`}
                      className="text-lg font-semibold hover:underline"
                    >
                      {feed.name}
                    </Link>
                    {feed.enabled ? (
                      <Badge variant="success">enabled</Badge>
                    ) : (
                      <Badge variant="secondary">disabled</Badge>
                    )}
                    {feed.token ? (
                      <Badge variant="info">token</Badge>
                    ) : (
                      <Badge variant="outline">public</Badge>
                    )}
                  </div>
                  <div className="text-sm text-muted-foreground">
                    slug: <code className="font-mono">{feed.slug}</code>
                    {" · "}
                    {feed._count.entries} entries
                    {feed.description ? ` · ${feed.description}` : ""}
                  </div>
                </div>
                <div className="flex items-center gap-3">
                  <label className="flex items-center gap-2 text-sm text-muted-foreground">
                    Enabled
                    <Switch
                      checked={feed.enabled}
                      onCheckedChange={(v) => startTransition(() => toggleEnabled(feed, v))}
                      aria-label={`Toggle ${feed.name}`}
                    />
                  </label>
                  <Button asChild variant="outline" size="sm">
                    <Link href={`/feeds/${feed.id}`}>Manage</Link>
                  </Button>
                </div>
              </div>

              <div className="mt-4 space-y-2">
                <div>
                  <div className="mb-1 text-xs font-medium text-muted-foreground">
                    Feed URL
                  </div>
                  <div className="flex items-center gap-2">
                    <code className="flex-1 truncate rounded-md border bg-muted px-3 py-1.5 font-mono text-xs">
                      {url}
                    </code>
                    <CopyButton text={url} />
                  </div>
                </div>
                <div>
                  <div className="mb-1 text-xs font-medium text-muted-foreground">
                    curl command
                  </div>
                  <div className="flex items-center gap-2">
                    <code className="flex-1 truncate rounded-md border bg-muted px-3 py-1.5 font-mono text-xs">
                      {curl}
                    </code>
                    <CopyButton text={curl} />
                  </div>
                </div>
              </div>

              {/* Inline IP manager: add + view current IPs without leaving the page */}
              <FeedCardIpPanel feedId={feed.id} />
            </CardContent>
          </Card>
        );
      })}
    </div>
  );
}
