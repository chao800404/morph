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
    // Content-only publishes reuse the active release's immutable build.
    sourceRevisionId: z.string().uuid().optional(),
    themeBuildId: z.string().uuid().optional(),
    expectedDraftRevisionId: z.string().uuid(),
    expectedDraftGeneration: z.number().int().min(1),
    expectedReleaseGeneration: z.number().int().min(1),
  });

export const updateStorefrontThemeSectionPropsInputSchema =
  storefrontThemeEditorInputSchema.extend({
    templateId: idSchema("storefront theme template"),
    sectionId: z.string().trim().min(1).max(100),
    props: z
      .record(z.string().trim().min(1).max(100), z.unknown())
      .refine((props) => Object.keys(props).length <= 100, {
        message: "Section props cannot contain more than 100 top-level fields",
      }),
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
  /** Public route selected from the source-derived Theme route registry. */
  routePath: z.string().trim().max(200).optional().catch(undefined),
  locale: z.string().trim().max(20).optional().catch(undefined),
});

export const storefrontThemePreviewSearchSchema = z.object({
  templateId: z.uuid(),
  /** Optional source route used when a Theme has more than one page route. */
  routePath: z.string().trim().max(200).optional().catch(undefined),
  viewportHeight: z.coerce.number().int().min(320).max(2160),
  editorOrigin: z.url().refine((value) => {
    const url = new URL(value);
    return (
      (url.protocol === "http:" || url.protocol === "https:") &&
      value === url.origin
    );
  }),
  previewSession: z.uuid(),
});

export type StorefrontThemeEditorSearch = z.infer<
  typeof storefrontThemeEditorSearchSchema
>;
