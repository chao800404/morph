import type { StorefrontStatus } from "@/db/storefront.schema";
import type { Metadata } from "@/db/json";
import type { SalesChannelType } from "@/lib/sales-channel/types";

export type StorefrontPreferencesDTO = Metadata & {
  accessMode: "private" | "public";
  seoTitle?: string;
  seoDescription?: string;
};

export interface StorefrontDTO {
  id: string;
  salesChannelId: string;
  name: string;
  domain: string | null;
  status: StorefrontStatus;
  activeThemeId: string | null;
  activeReleaseId: string | null;
  preferences: StorefrontPreferencesDTO;
}

export interface StorefrontDetailDTO extends StorefrontDTO {
  connectedSalesChannel: {
    id: string;
    name: string;
    type: SalesChannelType;
  } | null;
}
