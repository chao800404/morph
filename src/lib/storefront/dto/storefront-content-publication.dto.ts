import type { StorefrontContentPublicationItemType } from "@/db/storefront.schema";

export type StorefrontContentPublicationItemDTO = {
  id: string;
  publicationId: string;
  itemType: StorefrontContentPublicationItemType;
  contentId: string;
  revisionId: string;
  metadata?: { handle: string };
};

export type StorefrontContentPublicationDTO = {
  id: string;
  storefrontId: string;
  createdBy: string | null;
  createdAt: string;
  updatedAt: string;
  items: StorefrontContentPublicationItemDTO[];
};
