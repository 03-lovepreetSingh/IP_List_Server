# IP Feed Server

A self-hosted Next.js service that stores IP entries in a database and exposes
them as a **plain-text feed** over HTTP, designed to be polled by a firewall
(WiJungle NGFW) that loads the addresses into an **nftables address set** — an
"External Dynamic List" style fetcher.

The single most important contract: the response format and caching headers must
be exactly right. A malformed entry becomes an invalid nftables set element and
can break a live firewall ruleset.

---

## Stack

- **Next.js** (App Router) + TypeScript, strict mode
- **Prisma** ORM on **PostgreSQL** (tested against Neon)
- **Tailwind CSS** + shadcn-style UI primitives
- **Zod** validation shared between API routes and client forms
- **Vitest** for unit tests

---

## ⚠️ Security model

**The web GUI has no authentication.** It is intended to run on a **trusted
internal network** (or behind a reverse proxy that enforces access control).

Do **not** expose the GUI (`/`) or management API (`/api/feeds/**`) to the public
internet. Only the feed endpoint (`GET /api/feed/[slug]`) is safe to expose —
and even then, protect it with a per-feed bearer token if the network is untrusted.

---

## Setup

### 1. Install dependencies

```bash
npm install
```

### 2. Configure the database

Copy `.env.example` to `.env` and fill in `DATABASE_URL`:

```bash
cp .env.example .env
```

```env
# Runtime connection (use a POOLED endpoint for the app, e.g. Neon's -pooler host)
DATABASE_URL="postgresql://user:password@host/dbname?sslmode=require"

# Used ONLY by `prisma migrate` (DDL). Neon: use the DIRECT (non-pooler) host.
DATABASE_URL_DIRECT="postgresql://user:password@host/dbname?sslmode=require"

# Public base URL of the running server, for rendering feed URLs in the GUI.
NEXT_PUBLIC_BASE_URL="http://localhost:3000"
```

> **Which `provider`?** In `prisma/schema.prisma`, the datasource provider is set
> to `"postgresql"`. The column types are portable; switching to `"mysql"` and
> re-running migrations would also work, but the running deployment uses
> PostgreSQL.

### 3. Run migrations + seed

```bash
npx prisma migrate deploy     # apply the schema to your DB
npm run db:seed               # create two example feeds with sample entries
```

### 4. Run the dev server

```bash
npm run dev
```

Open <http://localhost:3000>.

### 5. Other commands

```bash
npm run build        # production build
npm test             # unit tests (validator + ETag/304)
npm run typecheck    # tsc --noEmit
npm run lint         # eslint
```

---

## The feed format (the firewall contract)

`GET /api/feed/[slug]`

### Response body

- `Content-Type: text/plain; charset=utf-8`
- **ONE entry per line**, `\n` separated, with a **trailing newline**.
- A short `#` header (feed name, generation timestamp, entry count).
- Only `enabled` entries from an `enabled` feed.
- Stable ordering: **family, then value** (so the ETag is deterministic).
- No JSON, quotes, commas, or wrapper — bare values only.

Example response:

```
# feed: Example blocklist
# generated: 2026-07-15T13:25:15.000Z
# count: 5
10.0.0.0/24
10.0.0.1-10.0.0.50
10.0.0.5
192.168.1.0/24
2001:db8::/32
```

### Accepted entry shapes (exactly three)

| Shape | Example (v4) | Example (v6) |
|-------|--------------|--------------|
| Single address | `10.0.0.5` | `2001:db8::1` |
| CIDR network | `10.0.0.0/24` | `2001:db8::/32` |
| Inclusive range | `10.0.0.1-10.0.0.50` | *(not supported — v4 only)* |

### Normalisation (applied on write)

- Whitespace trimmed.
- IPv6 lowercased.
- Range inner spaces stripped: `10.0.0.1 - 10.0.0.50` → `10.0.0.1-10.0.0.50`.
- **CIDR host bits are auto-masked** to the network address:
  `10.0.0.5/24` → `10.0.0.0/24`. (Chosen over rejection because nftables
  prefix elements require the network address anyway, and auto-masking is
  forgiving when an operator pastes a host-on-the-network. The canonical
  masked value is returned on write, so nothing happens silently.)

### Query parameters

- `?family=4` — only IPv4.
- `?family=6` — only IPv6.
- omitted — both families.

The firewall typically keeps v4 and v6 in separate nftables sets, so it will
likely call the feed **once per family**.

### Caching (the poller depends on it)

- **`ETag`**: strong, `sha256` hex of the exact body, quoted.
- **`Last-Modified`**: the max `updatedAt` across the feed's included entries.
- Honours **`If-None-Match`** and **`If-Modified-Since`** → returns
  **`304 Not Modified`** with an empty body and the same ETag.
- **`Cache-Control: no-cache`** — revalidate every request, but 304s allowed.
- The route is fully dynamic (`export const dynamic = "force-dynamic"`); no
  Next.js static caching or ISR.

### Auth

- If the feed has a `token`, requires `Authorization: Bearer <token>` (else `401`).
- Token compared in **constant time**.
- A public feed (`token = null`) needs no header.

### Errors

- Unknown slug or disabled feed → `404` plain text.
- Over the 10,000-entry cap → `500` (never a partial/truncated list — the poller
  would treat a truncated list as a valid shrunken list and remove live entries).

---

## Pointing the firewall at a feed URL

### Public feed

```
GET http://your-server:3000/api/feed/allowlist
```

### Token-protected feed

```
GET http://your-server:3000/api/feed/blocklist
Authorization: Bearer <token>
```

### Verify with curl

```bash
# Public feed
curl -sS http://localhost:3000/api/feed/allowlist

# Token-protected feed
curl -sS -H "Authorization: Bearer seed-secret-token-12345678" \
  http://localhost:3000/api/feed/blocklist

# Test conditional requests (should return 304 on the second call)
ETAG=$(curl -sS -D - -o /dev/null \
  -H "Authorization: Bearer seed-secret-token-12345678" \
  http://localhost:3000/api/feed/blocklist | grep -i etag)
curl -sS -o /dev/null -w "%{http_code}\n" \
  -H "Authorization: Bearer seed-secret-token-12345678" \
  -H "If-None-Match: $ETAG" \
  http://localhost:3000/api/feed/blocklist   # -> 304
```

### Firewall polling notes

- Poll on a sensible interval (e.g. 60–300s).
- Always send `If-None-Match` with the last ETag to get cheap `304`s.
- If you split v4/v6 into separate nftables sets, call once with `?family=4`
  and once with `?family=6`.
- Treat any non-`200`/`304` response as "do not update" — never load a partial
  body into a live ruleset.

---

## Management API

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/api/feeds` | List feeds (with entry counts) |
| `POST` | `/api/feeds` | Create a feed |
| `GET` | `/api/feeds/[id]` | Get a feed |
| `PATCH` | `/api/feeds/[id]` | Update name/description/enabled |
| `DELETE` | `/api/feeds/[id]` | Delete a feed (cascades to entries) |
| `POST` | `/api/feeds/[id]/rotate-token` | Rotate or clear the bearer token |
| `GET` | `/api/feeds/[id]/entries` | List entries (filter: `?family=&kind=&enabled=&search=`) |
| `POST` | `/api/feeds/[id]/entries` | Add a single entry |
| `PATCH` | `/api/feeds/[id]/entries/[entryId]` | Edit an entry |
| `DELETE` | `/api/feeds/[id]/entries/[entryId]` | Delete an entry |
| `POST` | `/api/feeds/[id]/entries/bulk` | Bulk import (all-or-nothing transaction) |

Bulk import body: `{ "blob": "10.0.0.1\n10.0.0.0/24,..." }`
Bulk import response: `{ "added": N, "skipped": [{ "line": 2, "value": "...", "reason": "..." }] }`

---

## Architecture

The parse / normalise / validate logic lives in **one shared module**:
[`src/lib/ip.ts`](src/lib/ip.ts). It is imported by both the API routes and the
GUI's live preview, so the two surfaces can **never disagree** on what an entry
means. The same module is browser-safe (no `node:` imports).

Feed serialization (`src/lib/feed-serialize.ts`) and caching helpers
(`src/lib/feed-cache.ts`) are likewise shared between the feed route and the GUI
"Preview raw feed" panel — the operator sees byte-for-byte what the firewall
receives.

### Data model

See [`prisma/schema.prisma`](prisma/schema.prisma):

- `Feed` — slug, name, description, optional token, enabled flag.
- `IpEntry` — value (canonical), kind (IP/CIDR/RANGE), family (4/6, derived on
  write), enabled, description. Unique on `(feedId, value)`.
