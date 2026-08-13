import type { Metadata } from "@/db/json";
import type { SalesChannelType } from "@/lib/sales-channel/types";

export interface SalesChannelDTO {
  id: string;
  name: string;
  type: SalesChannelType;
  description: string | null;
  /** Disabled channels keep their products but stop serving the storefront. */
  isDisabled: boolean;
  /** Free-form store-defined data; never trusted to hold anything private. */
  metadata: Metadata;
  createdAt: Date;
  updatedAt: Date;
}

export interface SalesChannelSummaryDTO extends SalesChannelDTO {
  /** The Store points to this channel; it cannot be deleted. */
  isDefault?: boolean;
  /** How many products list in this channel. Counted, not joined. */
  productCount: number;
}

export interface SalesChannelInsertDTO {
  id: string;
  name: string;
  type?: SalesChannelType;
  description?: string | null;
  isDisabled?: boolean;
}

export interface UpdateSalesChannelDTO {
  name?: string;
  description?: string | null;
  isDisabled?: boolean;
  metadata?: Metadata;
}
