import { PrismaClient } from "@prisma/client";
import { parseIpEntry, isParsedEntry } from "../src/lib/ip";

/**
 * Seed script: creates two example feeds with entries covering every kind
 * (IP / CIDR / RANGE) and both families (v4 / v6).
 *
 * Run:  npm run db:seed   (or: npx tsx prisma/seed.ts)
 *
 * Idempotent-ish: upserts feeds by slug, and replaces entries on re-run
 * so re-seeding doesn't accumulate duplicates.
 */
const prisma = new PrismaClient();

type Spec = { value: string; description?: string };

const blocklistEntries: Spec[] = [
  // Single IPv4
  { value: "10.0.0.5", description: "gateway host" },
  { value: "203.0.113.42", description: "RFC 5737 example" },
  // CIDR IPv4 (host bits get auto-masked by the parser)
  { value: "10.0.0.0/24", description: "internal subnet" },
  { value: "192.168.1.99/24", description: "auto-masks to 192.168.1.0/24" },
  // Range IPv4
  { value: "10.0.0.1-10.0.0.50", description: "DHCP pool" },
  // Single IPv6
  { value: "2001:DB8::1", description: "v6 gateway (lowercased on store)" },
  // CIDR IPv6
  { value: "2001:db8::/32", description: "documentation prefix" },
];

const allowlistEntries: Spec[] = [
  { value: "172.16.0.1", description: "allowed host" },
  { value: "172.16.0.0/16", description: "allowed subnet" },
  { value: "2001:db8:abcd::1", description: "allowed v6 host" },
];

async function main() {
  // Feed 1: a token-protected blocklist.
  const blocklist = await prisma.feed.upsert({
    where: { slug: "blocklist" },
    update: {},
    create: {
      slug: "blocklist",
      name: "Example blocklist",
      description: "Seed data — covers IP, CIDR, RANGE and v4/v6.",
      token: "seed-secret-token-12345678",
      enabled: true,
    },
  });

  // Feed 2: a public allowlist.
  const allowlist = await prisma.feed.upsert({
    where: { slug: "allowlist" },
    update: {},
    create: {
      slug: "allowlist",
      name: "Example allowlist",
      description: "Seed data — public feed, no token.",
      token: null,
      enabled: true,
    },
  });

  await seedEntries(blocklist.id, blocklistEntries);
  await seedEntries(allowlist.id, allowlistEntries);

  console.log("Seed complete.");
  console.log(`  blocklist  → /api/feed/blocklist  (token: seed-secret-token-12345678)`);
  console.log(`  allowlist  → /api/feed/allowlist  (public)`);
}

async function seedEntries(feedId: string, specs: Spec[]) {
  // Wipe existing entries for a clean re-seed, then re-insert parsed+normalised.
  await prisma.ipEntry.deleteMany({ where: { feedId } });
  for (const spec of specs) {
    const parsed = parseIpEntry(spec.value);
    if (!isParsedEntry(parsed)) {
      throw new Error(`seed value "${spec.value}" failed to parse: ${parsed.reason}`);
    }
    await prisma.ipEntry.create({
      data: {
        feedId,
        value: parsed.value,
        kind: parsed.kind,
        family: parsed.family,
        enabled: true,
        description: spec.description ?? null,
      },
    });
  }
  console.log(`  seeded ${specs.length} entries into feed ${feedId}`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
