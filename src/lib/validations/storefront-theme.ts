import { z } from "zod";
import { idSchema } from "./commerce";

export const storefrontThemeEditorInputSchema = z.object({
  storefrontId: idSchema("storefront"),
  themeId: idSchema("storefront theme"),
});

export const storefrontThemeEditorSearchSchema = z.object({
  template: z
    .enum(["index", "product", "collection", "page", "blog"])
    .catch("index"),
  templateId: z.uuid().optional().catch(undefined),
  viewport: z.enum(["desktop", "tablet", "mobile"]).catch("desktop"),
  canvasWidth: z.coerce
    .number()
    .int()
    .min(320)
    .max(1920)
    .optional()
    .catch(undefined),
  section: z.string().trim().max(100).optional().catch(undefined),
  locale: z.string().trim().max(20).optional().catch(undefined),
});

export const storefrontThemePreviewSearchSchema = z.object({
  templateId: z.uuid(),
  viewportHeight: z.coerce.number().int().min(320).max(2160),
});

export type StorefrontThemeEditorSearch = z.infer<
  typeof storefrontThemeEditorSearchSchema
>;
