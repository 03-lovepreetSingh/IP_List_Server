/**
 * # Feed body serializer
 *
 * The EXACT byte format the firewall receives. Shared between the feed
 * route handler and the GUI "Preview raw feed" panel so the operator
 * sees byte-for-byte what nftables will load.
 *
 * Format contract (do not change without updating the firewall side):
 *   - Content-Type: text/plain; charset=utf-8
 *   - A short `#` header (name, generation timestamp, entry count)
 *   - ONE entry per line, \n separated
 *   - Trailing newline at end
 *   - Stable ordering: family ASC, then value ASC (deterministic ETag)
 *
 * DETERMINISM: the `# generated:` timestamp must be derived from the data
 * (the max updatedAt of included entries), NOT from wall-clock time. If it
 * used `new Date()`, the body would change every request and the ETag would
 * never match — defeating the 304 caching contract the firewall depends on.
 */

export interface FeedEntryRow {
  value: string;
  family: number;
  updatedAt?: Date;
}

/**
 * Serialize feed entries into the plain-text body.
 *
 * @param feedName      Feed name, used in the header comment.
 * @param entries       Entries to include (already filtered to enabled).
 * @param generatedAt   Data-derived timestamp (max updatedAt) for the header.
 *                       Defaults to the epoch of an empty feed (1970) so an
 *                       empty feed is also stable across requests.
 */
export function serializeFeedBody(
  feedName: string,
  entries: FeedEntryRow[],
  generatedAt?: Date
): string {
  // Stable order: family first (v4 before v6), then lexicographic value.
  const sorted = [...entries].sort((a, b) => {
    if (a.family !== b.family) return a.family - b.family;
    return a.value < b.value ? -1 : a.value > b.value ? 1 : 0;
  });

  // Deterministic timestamp: from the data, or epoch for an empty feed.
  const ts = generatedAt ?? new Date(0);

  const lines: string[] = [
    `# feed: ${feedName}`,
    `# generated: ${ts.toISOString()}`,
    `# count: ${sorted.length}`,
  ];
  for (const e of sorted) {
    lines.push(e.value);
  }
  // Trailing newline: each line including the last is \n-terminated.
  return lines.join("\n") + "\n";
}

/** Strict check: is the family param one of the allowed values? */
export function isValidFamilyParam(value: string | null): boolean {
  return value === null || value === "" || value === "4" || value === "6";
}
