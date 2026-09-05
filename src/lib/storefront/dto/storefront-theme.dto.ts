import type {
  StorefrontPageDocument,
  StorefrontStatus,
  StorefrontTemplateType,
  StorefrontThemeStatus,
} from "@/db/storefront.schema";

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
    activeRelease: {
      id: string;
      sourceRevisionId: string;
      themeBuildId: string;
      /** Source generation the release's artifact was built from. */
      sourceGeneration: number;
    } | null;
  };
  templates: Array<{
    id: string;
    type: StorefrontTemplateType;
    name: string;
    document: StorefrontPageDocument;
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
  panelWidths?: {
    left: number;
    right: number;
  };
}
