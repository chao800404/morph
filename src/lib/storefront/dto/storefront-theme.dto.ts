import type {
  StorefrontPageDocument,
  StorefrontStatus,
  StorefrontTemplateType,
  StorefrontThemeStatus,
} from "@/db/storefront.schema";

export interface StorefrontThemeEditorDTO {
  storefront: {
    id: string;
    name: string;
    domain: string | null;
    status: StorefrontStatus;
  };
  theme: {
    id: string;
    name: string;
    status: StorefrontThemeStatus;
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
  panelWidths?: {
    left: number;
    right: number;
  };
}
