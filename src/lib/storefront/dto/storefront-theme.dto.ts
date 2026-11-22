import type {
  StorefrontPageDocument,
  StorefrontStatus,
  StorefrontTemplateType,
  StorefrontThemeStatus,
} from "@/db/storefront.schema";
import type { ThemePreviewRuntime } from "@/lib/storefront/theme-preview-runtime";
import type { ThemeRouteSectionResult } from "../compiler/theme-route-sections";

/**
 * The route structure of a template whose framework Core reads through the
 * `.astro` parser (Astro). Never derived while the editor context is read:
 * that would call the parser on every save refetch, preview read and write
 * precondition (M2 plan v2 §5.1). The structure is the route's binding view
 * (`readThemeRouteBindings`), read on its own. Explicit, not `null`: null
 * reads as "the Document owns the structure".
 */
export type SourceAnalysisRouteStructure = Readonly<{
  kind: "source-analysis";
  via: "route-bindings";
}>;

export const SOURCE_ANALYSIS_ROUTE_STRUCTURE: SourceAnalysisRouteStructure =
  Object.freeze({ kind: "source-analysis", via: "route-bindings" });

/** Whether a template's structure is left to the route binding view. */
export function isSourceAnalysisRouteStructure(
  structure: unknown,
): structure is SourceAnalysisRouteStructure {
  return (
    typeof structure === "object" &&
    structure !== null &&
    (structure as { kind?: unknown }).kind === "source-analysis"
  );
}

/**
 * Where a Theme stands against the current Starter, from its stored version.
 * `pending`: the version is missing or not a positive whole number, so
 * nothing says which Starter the files came from. Never shown as the latest.
 */
export type StarterVersionState = "current" | "available" | "pending";

export type StarterUpgradeStatusDTO = {
  versionState: StarterVersionState;
  storedVersion: number | null;
  currentVersion: number;
  /**
   * What the product catalog has waiting for review: `install` adds the
   * product list and product detail pages, `update` corrects catalog files
   * Morph wrote earlier. `null` when it has nothing to write.
   */
  catalogPending: "install" | "update" | null;
};

export interface StorefrontThemeEditorDTO {
  previewChannel?: {
    editorOrigin: string;
    sessionId: string;
  };
  /** Read when the editor opens; opening it upgrades nothing. */
  starterUpgrade?: StarterUpgradeStatusDTO | null;
  storefront: {
    id: string;
    name: string;
    domain: string | null;
    status: StorefrontStatus;
    activeReleaseId: string | null;
  };
  theme: {
    id: string;
    name: string;
    status: StorefrontThemeStatus;
    releaseGeneration: number;
    /**
     * The framework the site records (`storefront_themes.framework`), as
     * stored; NULL reads as TanStack Start. Live Preview is started for it,
     * and refuses one it cannot serve.
     */
    framework: string | null;
    /**
     * The Live Preview runtime the Theme records
     * (`storefront_themes.preview_runtime`), or null when it records none and
     * is previewed as the deployment says (`previewRuntimeDefault`).
     */
    previewRuntime: ThemePreviewRuntime | null;
    activeRelease: {
      id: string;
      sourceRevisionId: string;
      themeBuildId: string;
      /** Source generation the release's artifact was built from. */
      sourceGeneration: number;
      /**
       * Its build was sealed with content and did not prove its artifact
       * free of it, so publishing other content needs a new build.
       */
      buildBoundToContent: boolean;
    } | null;
  };
  templates: Array<{
    id: string;
    type: StorefrontTemplateType;
    name: string;
    /**
     * The one static source route this document holds content for. Absent
     * or null for a document shared by every route of its type.
     */
    routePath?: string | null;
    document: StorefrontPageDocument;
    /**
     * Source-derived view only; never a replacement for the stored document.
     * `SourceAnalysisRouteStructure` on an Astro Theme: read the route's
     * binding view instead.
     */
    routeStructure?:
      ThemeRouteSectionResult | SourceAnalysisRouteStructure | null;
    draftRevisionId: string | null;
    /** The revision this template's own last publish chose. */
    publishedRevisionId: string | null;
    /**
     * The revision the active release serves for this template, or null when
     * it serves none (or nothing is live). Differs from `publishedRevisionId`
     * after a rollback, which moves only the live pointer. Optional so a
     * context built without it compares as the row alone.
     */
    liveRevisionId?: string | null;
    draftGeneration: number;
  }>;
  /**
   * Inspector tab restored from a cookie.
   *
   * Server-provided because reading it from `localStorage` during the first
   * render disagrees with the server's HTML and costs the whole tree.
   */
  panelTab?: string;
  /**
   * The deployment's Live Preview runtime (`MORPH_THEME_PREVIEW_RUNTIME`),
   * which a Theme recording none is previewed with. Server-provided: the
   * editor cannot read the deployment's environment.
   */
  previewRuntimeDefault?: ThemePreviewRuntime;
  panelWidths?: {
    left: number;
    right: number;
  };
}
