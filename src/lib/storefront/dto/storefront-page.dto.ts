import type {
  StorefrontPageDocument,
  StorefrontPageStatus,
} from "@/db/storefront.schema";
import type { Metadata } from "@/db/json";

export interface StorefrontPageSummaryDTO {
  id: string;
  title: string;
  handle: string;
  status: StorefrontPageStatus;
  updatedAt: string;
}

export interface StorefrontPageDTO extends StorefrontPageSummaryDTO {
  createdAt: string;
  version: number;
  document: StorefrontPageDocument;
  publishedRevisionId: string | null;
  metadata: Metadata;
}

export interface StorefrontPageRevisionDTO {
  id: string;
  version: number;
  createdAt: string;
  publishedAt: string | null;
  isDraft: boolean;
  isPublished: boolean;
}
