import { z } from "zod";
import { idSchema } from "./commerce";

export const storefrontThemeEditorInputSchema = z.object({
  storefrontId: idSchema("storefront"),
  themeId: idSchema("storefront theme"),
});

export const reorderStorefrontThemeSectionsInputSchema =
  storefrontThemeEditorInputSchema.extend({
    templateId: idSchema("storefront theme template"),
    sectionIds: z.array(z.string().trim().min(1).max(100)).min(1).max(100),
    expectedDraftGeneration: z.number().int().min(1),
  });

export const publishStorefrontThemeTemplateInputSchema =
  storefrontThemeEditorInputSchema.extend({
    templateId: idSchema("storefront theme template"),
    sourceRevisionId: z.string().uuid(),
    themeBuildId: z.string().uuid(),
    expectedDraftRevisionId: z.string().uuid(),
    expectedDraftGeneration: z.number().int().min(1),
    expectedReleaseGeneration: z.number().int().min(1),
  });

export const updateStorefrontThemeSectionPropsInputSchema =
  storefrontThemeEditorInputSchema.extend({
    templateId: idSchema("storefront theme template"),
    sectionId: z.string().trim().min(1).max(100),
    props: z.record(z.string(), z.any()),
    expectedDraftGeneration: z.number().int().min(1),
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
