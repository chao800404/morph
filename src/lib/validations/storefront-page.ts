import { handleSchema, typedHandleSchema } from "@/lib/validations/product";
import { metadataInputSchema } from "@/lib/validations/product";
import { z } from "zod";

export const storefrontPageStatusSchema = z.enum([
  "draft",
  "published",
  "archived",
]);

export const storefrontPageDocumentSchema = z.object({
  version: z.literal(1),
  sections: z
    .array(
      z.object({
        id: z.string().trim().min(1).max(100),
        type: z.string().trim().min(1).max(100),
        componentRef: z.string().trim().min(1).max(160).optional().nullable(),
        enabled: z.boolean().default(true),
        props: z.record(z.string(), z.json()),
      }),
    )
    .max(100),
});

export const listStorefrontPagesInputSchema = z.object({
  query: z.string().trim().max(200).nullish(),
  sortBy: z.enum(["title", "createdAt", "updatedAt"]).default("updatedAt"),
  sortOrder: z.enum(["asc", "desc"]).default("desc"),
  page: z.number().int().min(1).max(10_000).default(1),
  limit: z.number().int().min(1).max(100).default(20),
});

export const getStorefrontPageInputSchema = z.object({ id: z.uuid() });

export const createStorefrontPageInputSchema = z.object({
  title: z.string().trim().min(1, "Title is required").max(200),
  handle: typedHandleSchema.optional(),
  publish: z.boolean().default(false),
});

export const updateStorefrontPageInputSchema = z.object({
  id: z.uuid(),
  title: z.string().trim().min(1).max(200),
  handle: handleSchema,
  document: storefrontPageDocumentSchema,
  publish: z.boolean().default(false),
});

export const updateStorefrontPageMetadataInputSchema = z.object({
  id: z.uuid(),
  metadata: metadataInputSchema,
});

export const listStorefrontPageRevisionsInputSchema = z.object({
  id: z.uuid(),
  page: z.number().int().min(1).max(10_000).default(1),
  limit: z.number().int().min(1).max(100).default(20),
});

export const restoreStorefrontPageRevisionInputSchema = z.object({
  id: z.uuid(),
  revisionId: z.uuid(),
});
