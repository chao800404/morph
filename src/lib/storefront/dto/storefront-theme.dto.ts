import type {
  StorefrontPageDocument,
  StorefrontStatus,
  StorefrontTemplateType,
  StorefrontThemeStatus,
} from "@/db/storefront.schema";
import type { ThemePreviewRuntime } from "@/lib/storefront/theme-preview-runtime";
import type { ThemeRouteSectionResult } from "../compiler/theme-route-sections";

export interface StorefrontThemeEditorDTO {
  previewChannel?: {
    editorOrigin: string;
    sessionId: string;
  };
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
    /** Source-derived view only; never a replacement for the stored document. */
    routeStructure?: ThemeRouteSectionResult | null;
    draftRevisionId: string | null;
    publishedRevisionId: string | null;
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
