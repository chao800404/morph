import type { Metadata } from "@/db/json";

export interface ReservationDTO {
  id: string;
  inventoryItemId: string;
  inventoryItemTitle: string | null;
  inventoryItemSku: string | null;
  inventoryItemUnitOfMeasure: string | null;
  locationId: string;
  locationName: string | null;
  quantity: number;
  allowBackorder: boolean;
  description: string | null;
  externalId: string | null;
  lineItemId: string | null;
  cartId: string | null;
  createdBy: string | null;
  expiresAt: Date | null;
  metadata: Metadata;
  createdAt: Date;
  updatedAt: Date;
  isManual: boolean;
}
