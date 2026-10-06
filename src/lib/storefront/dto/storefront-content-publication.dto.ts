import type {
  StorefrontContentPublicationItemType,
  StorefrontTemplateType,
} from "@/db/storefront.schema";

const TEMPLATE_TYPES: Record<StorefrontTemplateType, true> = {
  index: true,
  product: true,
  collection: true,
  page: true,
  blog: true,
  layout: true,
};
export function isStorefrontTemplateType(
  value: unknown,
): value is StorefrontTemplateType {
  return typeof value === "string" && Object.hasOwn(TEMPLATE_TYPES, value);
}

export type StorefrontContentPublicationItemDTO = {
  id: string;
  publicationId: string;
  itemType: StorefrontContentPublicationItemType;
  contentId: string;
  revisionId: string;
  metadata?: {
    handle?: string;
    routePath?: string;
    templateType?: StorefrontTemplateType;
  };
};

export type StorefrontContentPublicationDTO = {
  id: string;
  storefrontId: string;
  createdBy: string | null;
  createdAt: string;
  updatedAt: string;
  items: StorefrontContentPublicationItemDTO[];
};
