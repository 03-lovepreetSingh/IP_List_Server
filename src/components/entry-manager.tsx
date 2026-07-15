"use client";

import { useMemo, useState } from "react";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { api } from "@/lib/api-client";
import { parseIpEntry, isParsedEntry, parseBulk, partitionBulk } from "@/lib/ip";
import { CopyButton } from "@/components/copy-button";
import { serializeFeedBody } from "@/lib/feed-serialize";
import { Trash2, Pencil, X, Plus, Upload } from "lucide-react";

type Entry = {
  id: string;
  value: string;
  kind: "IP" | "CIDR" | "RANGE";
  family: 4 | 6;
  enabled: boolean;
  description: string | null;
  updatedAt: string;
};

type Feed = {
  id: string;
  slug: string;
  name: string;
  description: string | null;
  token: string | null;
  enabled: boolean;
  fullUrl: string;
};

type SortKey = "value" | "kind" | "family" | "enabled" | "updatedAt";

export function EntryManager({
  feed,
  initialEntries,
}: {
  feed: Feed;
  initialEntries: Entry[];
}) {
  const [entries, setEntries] = useState(initialEntries);
  const [search, setSearch] = useState("");
  const [familyFilter, setFamilyFilter] = useState<"all" | 4 | 6>("all");
  const [kindFilter, setKindFilter] = useState<"all" | "IP" | "CIDR" | "RANGE">("all");
  const [sortKey, setSortKey] = useState<SortKey>("value");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("asc");
  const [previewFamily, setPreviewFamily] = useState<"all" | 4 | 6>("all");

  // Add-single state
  const [newValue, setNewValue] = useState("");
  const [newDesc, setNewDesc] = useState("");

  // Inline edit state
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editValue, setEditValue] = useState("");
  const [editDesc, setEditDesc] = useState("");

  // Bulk modal state
  const [bulkOpen, setBulkOpen] = useState(false);
  const [bulkBlob, setBulkBlob] = useState("");

  // Feed settings state
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [feedName, setFeedName] = useState(feed.name);
  const [feedDesc, setFeedDesc] = useState(feed.description ?? "");
  const [tokenRevealed, setTokenRevealed] = useState(false);

  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  // Live preview of the single-add value (shared parser => matches server).
  const livePreview = useMemo(() => {
    if (!newValue.trim()) return null;
    return parseIpEntry(newValue);
  }, [newValue]);

  const filtered = useMemo(() => {
    let list = entries.filter((e) => {
      if (familyFilter !== "all" && e.family !== familyFilter) return false;
      if (kindFilter !== "all" && e.kind !== kindFilter) return false;
      if (search && !e.value.toLowerCase().includes(search.toLowerCase())) return false;
      return true;
    });
    list = [...list].sort((a, b) => {
      let cmp = 0;
      switch (sortKey) {
        case "value":
          cmp = a.value < b.value ? -1 : a.value > b.value ? 1 : 0;
          break;
        case "kind":
          cmp = a.kind.localeCompare(b.kind);
          break;
        case "family":
          cmp = a.family - b.family;
          break;
        case "enabled":
          cmp = Number(a.enabled) - Number(b.enabled);
          break;
        case "updatedAt":
          cmp = a.updatedAt.localeCompare(b.updatedAt);
          break;
      }
      return sortDir === "asc" ? cmp : -cmp;
    });
    return list;
  }, [entries, familyFilter, kindFilter, search, sortKey, sortDir]);

  // Raw feed preview (shared serializer => byte-for-byte match with the route).
  const rawPreview = useMemo(() => {
    const enabled = entries.filter(
      (e) => e.enabled && (previewFamily === "all" || e.family === previewFamily)
    );
    return serializeFeedBody(
      feed.name,
      enabled.map((e) => ({ value: e.value, family: e.family }))
    );
  }, [entries, previewFamily, feed.name]);

  // Bulk validation preview (shared parser => matches server).
  const bulkPreview = useMemo(() => {
    if (!bulkBlob.trim()) return { valid: [], skipped: [] };
    return partitionBulk(parseBulk(bulkBlob));
  }, [bulkBlob]);

  function toggleSort(key: SortKey) {
    if (sortKey === key) {
      setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    } else {
      setSortKey(key);
      setSortDir("asc");
    }
  }

  async function addSingle(e: React.FormEvent) {
    e.preventDefault();
    if (!livePreview || !isParsedEntry(livePreview)) {
      setError(livePreview ? (livePreview as { reason: string }).reason : "empty value");
      return;
    }
    setError(null);
    try {
      const created = await api.post<Entry>(`/api/feeds/${feed.id}/entries`, {
        value: newValue,
        enabled: true,
        description: newDesc || null,
      });
      setEntries((prev) => [...prev, created]);
      setNewValue("");
      setNewDesc("");
    } catch (err) {
      setError(err instanceof Error ? err.message : "failed to add entry");
    }
  }

  async function toggleEntryEnabled(entry: Entry, enabled: boolean) {
    setEntries((prev) =>
      prev.map((e) => (e.id === entry.id ? { ...e, enabled } : e))
    );
    try {
      await api.patch(`/api/feeds/${feed.id}/entries/${entry.id}`, { enabled });
    } catch {
      setEntries((prev) =>
        prev.map((e) => (e.id === entry.id ? { ...e, enabled: !enabled } : e))
      );
    }
  }

  function startEdit(entry: Entry) {
    setEditingId(entry.id);
    setEditValue(entry.value);
    setEditDesc(entry.description ?? "");
  }

  async function saveEdit(entry: Entry) {
    setError(null);
    try {
      const updated = await api.patch<Entry>(`/api/feeds/${feed.id}/entries/${entry.id}`, {
        value: editValue,
        description: editDesc || null,
      });
      setEntries((prev) => prev.map((e) => (e.id === entry.id ? updated : e)));
      setEditingId(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "failed to save entry");
    }
  }

  async function deleteEntry(entry: Entry) {
    if (!confirm(`Delete "${entry.value}"?`)) return;
    try {
      await api.delete(`/api/feeds/${feed.id}/entries/${entry.id}`);
      setEntries((prev) => prev.filter((e) => e.id !== entry.id));
    } catch (err) {
      setError(err instanceof Error ? err.message : "failed to delete entry");
    }
  }

  async function bulkImport() {
    setError(null);
    setNotice(null);
    try {
      const res = await api.post<{ added: number; skipped: { line: number; value: string; reason: string }[] }>(
        `/api/feeds/${feed.id}/entries/bulk`,
        { blob: bulkBlob }
      );
      setNotice(`Added ${res.added} entr${res.added === 1 ? "y" : "ies"}${res.skipped.length ? `, skipped ${res.skipped.length}` : ""}.`);
      // Reload entries to reflect the committed state.
      const fresh = await api.get<Entry[]>(`/api/feeds/${feed.id}/entries`);
      setEntries(fresh);
      setBulkBlob("");
      setBulkOpen(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : "bulk import failed");
    }
  }

  async function rotateToken(makePublic: boolean) {
    try {
      const updated = await api.post<{ token: string | null }>(`/api/feeds/${feed.id}/rotate-token`, makePublic ? { public: true } : {});
      // The server component set the initial token; we mutate local view.
      // A full reload is cleaner, but we keep client state for snappiness.
      window.location.reload();
      void updated;
    } catch (err) {
      setError(err instanceof Error ? err.message : "token rotation failed");
    }
  }

  async function saveFeedSettings() {
    setError(null);
    try {
      await api.patch(`/api/feeds/${feed.id}`, {
        name: feedName,
        description: feedDesc || null,
      });
      setNotice("Feed settings saved.");
      setSettingsOpen(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : "failed to save settings");
    }
  }

  return (
    <div className="space-y-6">
      {error ? (
        <div className="rounded-md border border-destructive/50 bg-destructive/10 px-4 py-2 text-sm text-destructive">
          {error}
        </div>
      ) : null}
      {notice ? (
        <div className="rounded-md border border-emerald-500/50 bg-emerald-500/10 px-4 py-2 text-sm text-emerald-700 dark:text-emerald-300">
          {notice}
        </div>
      ) : null}

      {/* Feed URL + curl */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Feed URL</CardTitle>
          <CardDescription>The firewall polls this exact URL.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="flex items-center gap-2">
            <code className="flex-1 truncate rounded-md border bg-muted px-3 py-1.5 font-mono text-xs">
              {feed.fullUrl}
            </code>
            <CopyButton text={feed.fullUrl} />
          </div>
          <div className="flex items-center gap-2">
            <code className="flex-1 truncate rounded-md border bg-muted px-3 py-1.5 font-mono text-xs">
              {feed.token
                ? `curl -sS -H "Authorization: Bearer ${feed.token}" "${feed.fullUrl}"`
                : `curl -sS "${feed.fullUrl}"`}
            </code>
            <CopyButton
              text={
                feed.token
                  ? `curl -sS -H "Authorization: Bearer ${feed.token}" "${feed.fullUrl}"`
                  : `curl -sS "${feed.fullUrl}"`
              }
            />
          </div>
          <div className="flex gap-2">
            <Button variant="outline" size="sm" onClick={() => setSettingsOpen((v) => !v)}>
              Feed settings
            </Button>
          </div>
        </CardContent>
      </Card>

      {settingsOpen ? (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Feed settings</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="feed-name">Name</Label>
              <Input id="feed-name" value={feedName} onChange={(e) => setFeedName(e.target.value)} />
            </div>
            <div className="space-y-2">
              <Label htmlFor="feed-desc">Description</Label>
              <Input id="feed-desc" value={feedDesc} onChange={(e) => setFeedDesc(e.target.value)} />
            </div>
            <div className="space-y-2">
              <Label>Token</Label>
              <div className="flex items-center gap-2">
                <code className="flex-1 truncate rounded-md border bg-muted px-3 py-1.5 font-mono text-xs">
                  {feed.token
                    ? tokenRevealed
                      ? feed.token
                      : "••••••••••••••••"
                    : "(public feed — no token)"}
                </code>
                {feed.token ? (
                  <Button variant="outline" size="sm" onClick={() => setTokenRevealed((v) => !v)}>
                    {tokenRevealed ? "Hide" : "Reveal"}
                  </Button>
                ) : null}
                <Button variant="outline" size="sm" onClick={() => rotateToken(false)}>
                  Rotate
                </Button>
                {feed.token ? (
                  <Button variant="outline" size="sm" onClick={() => rotateToken(true)}>
                    Make public
                  </Button>
                ) : null}
              </div>
            </div>
            <div className="flex gap-2">
              <Button onClick={saveFeedSettings}>Save</Button>
              <Button variant="outline" onClick={() => setSettingsOpen(false)}>
                Cancel
              </Button>
            </div>
          </CardContent>
        </Card>
      ) : null}

      {/* Add single + bulk */}
      <div className="grid gap-6 md:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Add entry</CardTitle>
            <CardDescription>
              Live validation shows the parsed kind + family before you submit.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <form onSubmit={addSingle} className="space-y-3">
              <div className="space-y-2">
                <Label htmlFor="new-value">Value</Label>
                <Input
                  id="new-value"
                  value={newValue}
                  onChange={(e) => setNewValue(e.target.value)}
                  placeholder="10.0.0.5 / 10.0.0.0/24 / 10.0.0.1-10.0.0.50"
                  className="font-mono"
                />
                {livePreview ? (
                  isParsedEntry(livePreview) ? (
                    <div className="flex items-center gap-2 text-xs">
                      <Badge variant="success">valid</Badge>
                      <Badge variant="info">{livePreview.kind}</Badge>
                      <Badge variant="secondary">v{livePreview.family}</Badge>
                      <code className="font-mono text-muted-foreground">
                        → {livePreview.value}
                      </code>
                    </div>
                  ) : (
                    <div className="flex items-center gap-2 text-xs text-destructive">
                      <Badge variant="destructive">invalid</Badge>
                      <span>{(livePreview as { reason: string }).reason}</span>
                    </div>
                  )
                ) : null}
              </div>
              <div className="space-y-2">
                <Label htmlFor="new-desc">Description (optional)</Label>
                <Input id="new-desc" value={newDesc} onChange={(e) => setNewDesc(e.target.value)} />
              </div>
              <Button type="submit">
                <Plus className="size-4" /> Add entry
              </Button>
            </form>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Bulk import</CardTitle>
            <CardDescription>
              Paste newline or comma separated entries. Preview before committing.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Button variant="outline" onClick={() => setBulkOpen((v) => !v)}>
              <Upload className="size-4" /> Open bulk importer
            </Button>
          </CardContent>
        </Card>
      </div>

      {bulkOpen ? (
        <Card>
          <CardHeader>
            <div className="flex items-center justify-between">
              <div>
                <CardTitle className="text-base">Bulk import preview</CardTitle>
                <CardDescription>
                  All-or-nothing: if any row fails on commit, nothing is added.
                </CardDescription>
              </div>
              <Button variant="ghost" size="icon" onClick={() => setBulkOpen(false)}>
                <X className="size-4" />
              </Button>
            </div>
          </CardHeader>
          <CardContent className="space-y-4">
            <Textarea
              value={bulkBlob}
              onChange={(e) => setBulkBlob(e.target.value)}
              placeholder={"10.0.0.1\n10.0.0.0/24\n10.0.0.50-10.0.0.99\n# comment lines ignored"}
              rows={8}
            />
            {bulkBlob.trim() ? (
              <div className="rounded-md border">
                <div className="border-b bg-muted/50 px-3 py-1.5 text-xs font-medium">
                  {bulkPreview.valid.length} valid · {bulkPreview.skipped.length} skipped
                </div>
                <div className="max-h-60 overflow-auto">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead className="h-8">Line</TableHead>
                        <TableHead className="h-8">Value</TableHead>
                        <TableHead className="h-8">Status</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {parseBulk(bulkBlob).map((r) => {
                        const ok = isParsedEntry(r.result);
                        return (
                          <TableRow key={r.line}>
                            <TableCell className="font-mono text-xs">{r.line}</TableCell>
                            <TableCell className="font-mono text-xs">{r.raw}</TableCell>
                            <TableCell>
                              {ok ? (
                                <Badge variant="success">valid</Badge>
                              ) : (
                                <Badge variant="destructive">
                                  {(r.result as { reason: string }).reason}
                                </Badge>
                              )}
                            </TableCell>
                          </TableRow>
                        );
                      })}
                    </TableBody>
                  </Table>
                </div>
              </div>
            ) : null}
            <div className="flex gap-2">
              <Button onClick={bulkImport} disabled={bulkPreview.valid.length === 0}>
                Commit {bulkPreview.valid.length} valid
              </Button>
              <Button variant="outline" onClick={() => setBulkBlob("")}>
                Clear
              </Button>
            </div>
          </CardContent>
        </Card>
      ) : null}

      {/* Entries table */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Entries ({entries.length})</CardTitle>
          <div className="flex flex-wrap items-center gap-2 pt-2">
            <Input
              placeholder="Search values…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="h-8 max-w-[200px]"
            />
            <select
              value={familyFilter === "all" ? "all" : String(familyFilter)}
              onChange={(e) =>
                setFamilyFilter(e.target.value === "all" ? "all" : (Number(e.target.value) as 4 | 6))
              }
              className="h-8 rounded-md border bg-background px-2 text-sm"
            >
              <option value="all">All families</option>
              <option value="4">IPv4</option>
              <option value="6">IPv6</option>
            </select>
            <select
              value={kindFilter}
              onChange={(e) => setKindFilter(e.target.value as typeof kindFilter)}
              className="h-8 rounded-md border bg-background px-2 text-sm"
            >
              <option value="all">All kinds</option>
              <option value="IP">IP</option>
              <option value="CIDR">CIDR</option>
              <option value="RANGE">RANGE</option>
            </select>
          </div>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>
                  <button className="hover:underline" onClick={() => toggleSort("value")}>
                    Value
                  </button>
                </TableHead>
                <TableHead>
                  <button className="hover:underline" onClick={() => toggleSort("kind")}>
                    Kind
                  </button>
                </TableHead>
                <TableHead>
                  <button className="hover:underline" onClick={() => toggleSort("family")}>
                    Family
                  </button>
                </TableHead>
                <TableHead>Description</TableHead>
                <TableHead>
                  <button className="hover:underline" onClick={() => toggleSort("enabled")}>
                    Enabled
                  </button>
                </TableHead>
                <TableHead>
                  <button className="hover:underline" onClick={() => toggleSort("updatedAt")}>
                    Updated
                  </button>
                </TableHead>
                <TableHead>Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {filtered.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={7} className="py-8 text-center text-muted-foreground">
                    No entries match.
                  </TableCell>
                </TableRow>
              ) : (
                filtered.map((e) => (
                  <TableRow key={e.id}>
                    <TableCell className="font-mono text-xs">
                      {editingId === e.id ? (
                        <Input
                          value={editValue}
                          onChange={(ev) => setEditValue(ev.target.value)}
                          className="h-7 font-mono text-xs"
                        />
                      ) : (
                        e.value
                      )}
                    </TableCell>
                    <TableCell>
                      <Badge variant="info">{e.kind}</Badge>
                    </TableCell>
                    <TableCell>
                      <Badge variant="secondary">v{e.family}</Badge>
                    </TableCell>
                    <TableCell className="text-xs text-muted-foreground">
                      {editingId === e.id ? (
                        <Input
                          value={editDesc}
                          onChange={(ev) => setEditDesc(ev.target.value)}
                          className="h-7 text-xs"
                        />
                      ) : (
                        e.description ?? "—"
                      )}
                    </TableCell>
                    <TableCell>
                      <Switch
                        checked={e.enabled}
                        onCheckedChange={(v) => toggleEntryEnabled(e, v)}
                        aria-label={`Toggle ${e.value}`}
                      />
                    </TableCell>
                    <TableCell className="text-xs text-muted-foreground">
                      {new Date(e.updatedAt).toLocaleString()}
                    </TableCell>
                    <TableCell>
                      <div className="flex gap-1">
                        {editingId === e.id ? (
                          <>
                            <Button size="icon" variant="ghost" onClick={() => saveEdit(e)}>
                              <Plus className="size-4" />
                            </Button>
                            <Button size="icon" variant="ghost" onClick={() => setEditingId(null)}>
                              <X className="size-4" />
                            </Button>
                          </>
                        ) : (
                          <>
                            <Button size="icon" variant="ghost" onClick={() => startEdit(e)}>
                              <Pencil className="size-4" />
                            </Button>
                            <Button
                              size="icon"
                              variant="ghost"
                              onClick={() => deleteEntry(e)}
                              className="text-destructive hover:text-destructive"
                            >
                              <Trash2 className="size-4" />
                            </Button>
                          </>
                        )}
                      </div>
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      {/* Raw feed preview */}
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <div>
              <CardTitle className="text-base">Preview raw feed</CardTitle>
              <CardDescription>
                The exact bytes the firewall receives (enabled entries only).
              </CardDescription>
            </div>
            <select
              value={previewFamily === "all" ? "all" : String(previewFamily)}
              onChange={(e) =>
                setPreviewFamily(e.target.value === "all" ? "all" : (Number(e.target.value) as 4 | 6))
              }
              className="h-8 rounded-md border bg-background px-2 text-sm"
            >
              <option value="all">Both families</option>
              <option value="4">IPv4 only</option>
              <option value="6">IPv6 only</option>
            </select>
          </div>
        </CardHeader>
        <CardContent>
          <pre className="max-h-80 overflow-auto rounded-md border bg-muted p-3 font-mono text-xs">
            {rawPreview}
          </pre>
        </CardContent>
      </Card>
    </div>
  );
}
