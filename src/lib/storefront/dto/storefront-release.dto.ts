import type { StorefrontReleaseStatus } from "@/db/storefront.schema";

export type StorefrontReleaseDTO = {
  id: string;
  storefrontId: string;
  themeId: string;
  sourceRevisionId: string;
  themeBuildId: string;
  contentPublicationId: string | null;
  status: StorefrontReleaseStatus;
  metadata: Record<string, unknown> | null;
  createdBy: string | null;
  createdAt: string;
  updatedAt: string;
};
