import { z } from "zod";

/**
 * # Zod schemas — shared between API routes and client forms.
 *
 * Every input crossing the API boundary is validated here. The GUI imports
 * the same schemas so live client-side validation never disagrees with the
 * server's verdict.
 */

// Slug: used in the public feed URL. Keep it URL-safe and stable.
export const slugSchema = z
  .string()
  .min(1)
  .max(64)
  .regex(/^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/i, "slug must be alphanumeric with single hyphens")
  .transform((s) => s.toLowerCase());

export const createFeedSchema = z.object({
  slug: slugSchema,
  name: z.string().min(1).max(100),
  description: z.string().max(500).nullish(),
  // null = public feed; a string sets a bearer token.
  token: z.string().min(8).max(200).nullish(),
  enabled: z.boolean().optional().default(true),
});

export const updateFeedSchema = z.object({
  name: z.string().min(1).max(100).optional(),
  description: z.string().max(500).nullish().optional(),
  enabled: z.boolean().optional(),
});

// Entry value is validated by the IP parser, not Zod — Zod only checks it's
// a non-empty string here. The API route runs parseIpEntry on it.
export const createEntrySchema = z.object({
  value: z.string().min(1).max(100),
  enabled: z.boolean().optional().default(true),
  description: z.string().max(500).nullish(),
});

export const updateEntrySchema = z.object({
  value: z.string().min(1).max(100).optional(),
  enabled: z.boolean().optional(),
  description: z.string().max(500).nullish().optional(),
});

export const bulkImportSchema = z.object({
  // A newline/comma separated blob of entries.
  blob: z.string().min(1).max(1_000_000),
});

// Optional query params for listing entries.
export const listEntriesQuerySchema = z.object({
  family: z.union([z.literal("4"), z.literal("6")]).optional(),
  kind: z.union([z.literal("IP"), z.literal("CIDR"), z.literal("RANGE")]).optional(),
  enabled: z.union([z.literal("true"), z.literal("false")]).optional(),
  search: z.string().max(100).optional(),
});

export type CreateFeedInput = z.infer<typeof createFeedSchema>;
export type UpdateFeedInput = z.infer<typeof updateFeedSchema>;
export type CreateEntryInput = z.infer<typeof createEntrySchema>;
export type UpdateEntryInput = z.infer<typeof updateEntrySchema>;
export type BulkImportInput = z.infer<typeof bulkImportSchema>;
