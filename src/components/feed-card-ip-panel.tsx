"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { api } from "@/lib/api-client";
import { parseIpEntry, isParsedEntry } from "@/lib/ip";
import { ChevronDown, ChevronRight, Plus, RefreshCw } from "lucide-react";

type Entry = {
  id: string;
  value: string;
  kind: "IP" | "CIDR" | "RANGE";
  family: 4 | 6;
  enabled: boolean;
};

/**
 * Inline panel for a feed card on the home page.
 * Lazy: fetches entries only when first expanded.
 * Reuses the shared parser + management API so validation matches the
 * full entry manager exactly.
 */
export function FeedCardIpPanel({ feedId }: { feedId: string }) {
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [entries, setEntries] = useState<Entry[] | null>(null);
  const [newValue, setNewValue] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  async function load() {
    setLoading(true);
    setError(null);
    try {
      const data = await api.get<Entry[]>(`/api/feeds/${feedId}/entries`);
      setEntries(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : "failed to load entries");
    } finally {
      setLoading(false);
    }
  }

  function toggle() {
    const next = !open;
    setOpen(next);
    if (next && entries === null) {
      load();
    }
  }

  // Live validation with the shared parser (matches the server exactly).
  const preview = newValue.trim() ? parseIpEntry(newValue) : null;

  async function add(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setNotice(null);
    if (!preview || !isParsedEntry(preview)) {
      setError(preview ? (preview as { reason: string }).reason : "empty value");
      return;
    }
    try {
      const created = await api.post<Entry>(`/api/feeds/${feedId}/entries`, {
        value: newValue,
        enabled: true,
        description: null,
      });
      setEntries((prev) => (prev ? [...prev, created] : [created]));
      setNewValue("");
      setNotice(`Added ${created.value}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "failed to add entry");
    }
  }

  async function toggleEntry(entry: Entry, enabled: boolean) {
    setEntries((prev) =>
      prev ? prev.map((e) => (e.id === entry.id ? { ...e, enabled } : e)) : prev
    );
    try {
      await api.patch(`/api/feeds/${feedId}/entries/${entry.id}`, { enabled });
    } catch {
      setEntries((prev) =>
        prev ? prev.map((e) => (e.id === entry.id ? { ...e, enabled: !enabled } : e)) : prev
      );
    }
  }

  async function deleteEntry(entry: Entry) {
    if (!confirm(`Delete "${entry.value}"?`)) return;
    try {
      await api.delete(`/api/feeds/${feedId}/entries/${entry.id}`);
      setEntries((prev) => (prev ? prev.filter((e) => e.id !== entry.id) : prev));
    } catch (err) {
      setError(err instanceof Error ? err.message : "failed to delete entry");
    }
  }

  return (
    <div className="mt-4 rounded-lg border bg-muted/30 p-3">
      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={toggle}
          className="flex items-center gap-1 text-sm font-medium hover:underline"
        >
          {open ? <ChevronDown className="size-4" /> : <ChevronRight className="size-4" />}
          {open ? "Hide IPs" : "Show IPs"}
        </button>
        {entries ? (
          <span className="text-xs text-muted-foreground">
            {entries.length} entr{entries.length === 1 ? "y" : "ies"}
          </span>
        ) : null}
        {open ? (
          <Button
            variant="ghost"
            size="sm"
            onClick={load}
            className="ml-auto h-7"
            disabled={loading}
          >
            <RefreshCw className={`size-3.5 ${loading ? "animate-spin" : ""}`} />
            Refresh
          </Button>
        ) : null}
      </div>

      {open ? (
        <div className="mt-3 space-y-4">
          {/* Quick add */}
          <form onSubmit={add} className="space-y-2">
            <Label htmlFor={`add-${feedId}`} className="text-xs">
              Add IP / CIDR / range
            </Label>
            <div className="flex items-center gap-2">
              <Input
                id={`add-${feedId}`}
                value={newValue}
                onChange={(e) => setNewValue(e.target.value)}
                placeholder="10.0.0.5 / 10.0.0.0/24 / 10.0.0.1-10.0.0.50"
                className="font-mono text-sm"
              />
              <Button type="submit" size="sm" disabled={!preview || !isParsedEntry(preview)}>
                <Plus className="size-4" /> Add
              </Button>
            </div>
            {preview ? (
              isParsedEntry(preview) ? (
                <div className="flex flex-wrap items-center gap-2 text-xs">
                  <Badge variant="success">valid</Badge>
                  <Badge variant="info">{preview.kind}</Badge>
                  <Badge variant="secondary">v{preview.family}</Badge>
                  <code className="font-mono text-muted-foreground">→ {preview.value}</code>
                </div>
              ) : (
                <div className="flex items-center gap-2 text-xs text-destructive">
                  <Badge variant="destructive">invalid</Badge>
                  <span>{(preview as { reason: string }).reason}</span>
                </div>
              )
            ) : null}
          </form>

          {error ? (
            <p className="text-xs text-destructive">{error}</p>
          ) : null}
          {notice ? (
            <p className="text-xs text-emerald-600 dark:text-emerald-400">{notice}</p>
          ) : null}

          {/* Current IPs */}
          {loading && entries === null ? (
            <p className="text-xs text-muted-foreground">Loading…</p>
          ) : entries && entries.length === 0 ? (
            <p className="text-xs text-muted-foreground">No IPs yet. Add one above.</p>
          ) : entries ? (
            <div className="space-y-1">
              <div className="text-xs font-medium text-muted-foreground">Current IPs</div>
              <div className="max-h-64 overflow-auto rounded-md border bg-background">
                {entries.map((e) => (
                  <div
                    key={e.id}
                    className="flex items-center gap-2 border-b px-2 py-1.5 last:border-b-0"
                  >
                    <code className="flex-1 truncate font-mono text-xs">{e.value}</code>
                    <Badge variant="info" className="shrink-0">
                      {e.kind}
                    </Badge>
                    <Badge variant="secondary" className="shrink-0">
                      v{e.family}
                    </Badge>
                    <Switch
                      checked={e.enabled}
                      onCheckedChange={(v) => toggleEntry(e, v)}
                      aria-label={`Toggle ${e.value}`}
                    />
                    <button
                      type="button"
                      onClick={() => deleteEntry(e)}
                      className="text-xs text-destructive hover:underline"
                    >
                      delete
                    </button>
                  </div>
                ))}
              </div>
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
