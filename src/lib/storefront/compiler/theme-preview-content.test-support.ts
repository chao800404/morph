import type { StorefrontContentResult } from "@/lib/storefront/service/storefront-content-runtime";
import type { ThemePreviewContentSnapshot } from "./theme-preview-content";

const empty = (): StorefrontContentResult => ({ slots: {}, hiddenSlots: [] });

/**
 * A draft snapshot of the shape Core writes (`createThemePreviewContentSnapshot`),
 * with `content` laid over it.
 *
 * Core writes an entry for every template type and for the shell, empty where
 * there is no Document; the preview refuses a path whose entry is missing
 * rather than answering it empty. A fixture that names only the entries it
 * cares about gets the rest as Core would write them for no Document.
 */
export function previewContentAsCoreWrites(
  content: Partial<{
    templates: Partial<Record<string, unknown>>;
    pages: Record<string, unknown>;
    routes: Record<string, unknown>;
    shell: unknown;
    scoped: unknown;
  }> = {},
): ThemePreviewContentSnapshot {
  return {
    templates: {
      index: empty(),
      product: empty(),
      collection: empty(),
      page: empty(),
      blog: empty(),
      ...content.templates,
    },
    pages: { ...content.pages },
    routes: { ...content.routes },
    shell: (content.shell ?? empty()) as StorefrontContentResult,
    // The scoped reads' entries, as Core writes them for no Document. Not
    // derived from the merged entries above: a fixture that reads scoped
    // content names it.
    scoped: content.scoped ?? {
      layout: empty(),
      templates: {
        index: empty(),
        product: empty(),
        collection: empty(),
        page: empty(),
        blog: empty(),
      },
      pages: {},
      routes: {},
    },
  } as ThemePreviewContentSnapshot;
}
