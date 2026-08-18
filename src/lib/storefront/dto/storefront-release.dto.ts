import type { StorefrontReleaseStatus } from "@/db/storefront.schema";
import type { Metadata } from "@/db/json";

export type StorefrontReleaseDTO = {
  id: string;
  storefrontId: string;
  themeId: string;
  sourceRevisionId: string;
  themeBuildId: string;
  contentPublicationId: string | null;
  status: StorefrontReleaseStatus;
  metadata: Metadata | null;
  createdBy: string | null;
  createdAt: string;
  updatedAt: string;
};
