import { z } from "zod";
import { MAX_RELEASE_NOTE_LENGTH } from "@/lib/storefront/release-note";
import { idSchema } from "./commerce";
import { safeThemeFilePathSchema } from "./storefront-theme-file";

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
    /** What changed, for recognising this release in the history later. */
    note: z.string().trim().max(MAX_RELEASE_NOTE_LENGTH).optional(),
  });

/** Renaming an existing release, for a note written after the fact. */
export const renameStorefrontReleaseInputSchema =
  storefrontThemeEditorInputSchema.extend({
    releaseId: z.string().uuid(),
    note: z.string().trim().max(MAX_RELEASE_NOTE_LENGTH),
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
    /**
     * The route the editor is showing, so the server checks the write against
     * the component that route renders. Only selects among the routes the
     * saved source declares; it never names a file to read.
     */
    routePath: z.string().trim().min(1).max(512).optional(),
    /**
     * Fields whose stored value is removed, so the component's own default
     * renders again. Only declared fields; the server refuses anything else.
     */
    resetProps: z.array(z.string().trim().min(1).max(100)).max(100).optional(),
  });

/**
 * Turning fixed text in a component into a field, with this page's value.
 *
 * Every name here is checked against what is saved before anything is
 * written: the path must be a file of the Theme, the target an element in it,
 * and the confirmed impact exactly what the server finds the change reaches.
 */
export const promoteStorefrontThemeTextInputSchema =
  storefrontThemeEditorInputSchema.extend({
    templateId: idSchema("storefront theme template"),
    sectionId: z.string().trim().min(1).max(100),
    routePath: z.string().trim().min(1).max(512).optional(),
    componentSourcePath: safeThemeFilePathSchema,
    targetKey: z.string().trim().min(1).max(200),
    fieldName: z.string().trim().min(1).max(64),
    value: z.string().max(10_000),
    expectedSourceGeneration: z.number().int().min(1),
    expectedFileVersion: z.number().int().min(1),
    expectedDraftGeneration: z.number().int().min(1),
    confirmedImpact: z.array(z.string().max(1000)).max(200).optional(),
  });

/**
 * Creating (or finding) the document a static source route owns.
 *
 * Names a route, never a file: the server checks it against the routes the
 * saved source declares before anything is created.
 */
export const ensureStorefrontThemeRouteTemplateInputSchema =
  storefrontThemeEditorInputSchema.extend({
    routePath: z.string().trim().min(1).max(512),
  });

/**
 * Renaming one section placement.
 *
 * `null` clears the name and restores the derived one, which is why an empty
 * string is not accepted: "" and "cleared" would be the same request with two
 * spellings, and only one of them would survive a trim.
 */
export const renameStorefrontThemeSectionInputSchema =
  storefrontThemeEditorInputSchema.extend({
    templateId: idSchema("storefront theme template"),
    sectionId: z.string().trim().min(1).max(100),
    name: z.string().trim().min(1).max(100).nullable(),
    expectedDraftGeneration: z.number().int().min(1),
  });

export const storefrontThemeEditorSearchSchema = z.object({
  template: z
    .enum(["index", "product", "collection", "page", "blog", "layout"])
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
  /**
   * Page of the Release history surface.
   *
   * In the URL because the shared pager navigates rather than holding state,
   * and an unlisted key is stripped by this schema — so without it the pager
   * would render and do nothing.
   */
  releasePage: z.coerce.number().int().min(1).optional().catch(undefined),
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
