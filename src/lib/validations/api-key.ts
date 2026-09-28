import { z } from "zod";
import { idSchema } from "./commerce";

export const createPublishableApiKeyInputSchema = z.object({
  title: z.string().trim().min(1, "Title is required").max(200),
  salesChannelIds: z.array(idSchema("sales channel")).min(1).max(20),
});

export const revokePublishableApiKeyInputSchema = z.object({
  id: idSchema("API key"),
});

export const createSecretApiKeyInputSchema = z.object({
  title: z.string().trim().min(1, "Title is required").max(200),
});

export const updateSecretApiKeyTitleInputSchema = z.object({
  id: idSchema("API key"),
  title: z.string().trim().min(1, "Title is required").max(200),
});

export const revokeSecretApiKeyInputSchema = z.object({
  id: idSchema("API key"),
});

export const deleteSecretApiKeyInputSchema = z.object({
  id: idSchema("API key"),
});

export const listAdminApiKeysQuerySchema = z
  .object({
    type: z.enum(["secret", "publishable"]).optional(),
    q: z.string().trim().max(200).optional(),
    offset: z.coerce.number().int().min(0).max(100_000).default(0),
    limit: z.coerce.number().int().min(1).max(100).default(20),
    order: z
      .enum([
        "created_at",
        "-created_at",
        "updated_at",
        "-updated_at",
        "title",
        "-title",
      ])
      .default("-created_at"),
  })
  .strict()
  .transform((input) => ({
    ...input,
    query: input.q || undefined,
    sortBy: input.order.includes("updated_at")
      ? ("updatedAt" as const)
      : input.order.includes("title")
        ? ("title" as const)
        : ("createdAt" as const),
    sortOrder: input.order.startsWith("-")
      ? ("desc" as const)
      : ("asc" as const),
  }));

export const createAdminApiKeyBodySchema = z
  .object({
    title: z.string().trim().min(1).max(200),
    type: z.enum(["secret", "publishable"]),
  })
  .strict();

export const updateAdminApiKeyBodySchema = z
  .object({ title: z.string().trim().min(1).max(200) })
  .strict();

export const managePublishableApiKeySalesChannelsBodySchema = z
  .object({
    add: z.array(idSchema("sales channel")).max(100).default([]),
    remove: z.array(idSchema("sales channel")).max(100).default([]),
  })
  .strict()
  .refine((input) => input.add.length > 0 || input.remove.length > 0)
  .refine((input) => !input.add.some((id) => input.remove.includes(id)), {
    message: "A sales channel cannot be added and removed together",
  });
