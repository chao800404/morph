import type { Metadata } from "@/db/json";

export interface InventoryLocationLevelDTO {
  id: string;
  locationId: string;
  locationName: string | null;
  unitOfMeasure: string | null;
  stockedQuantity: number;
  reservedQuantity: number;
  incomingQuantity: number;
  availableQuantity: number;
  metadata: Metadata;
  createdAt: Date;
  updatedAt: Date;
  deletedAt?: Date | null;
}

export interface InventoryListItemDTO {
  id: string;
  description: string | null;
  thumbnail: string | null;
  unitOfMeasure: string | null;
  requiresShipping: boolean;
  weight: number | null;
  length: number | null;
  height: number | null;
  width: number | null;
  originCountry: string | null;
  hsCode: string | null;
  midCode: string | null;
  material: string | null;
  metadata: Metadata;
  /** Direct edit target when this inventory item belongs to one variant. */
  productId: string | null;
  variantId: string | null;
  title: string | null;
  sku: string | null;
  variantCount: number;
  stockedQuantity: number;
  reservedQuantity: number;
  incomingQuantity: number;
  availableQuantity: number;
  locationLevels: InventoryLocationLevelDTO[];
  createdAt: Date;
  updatedAt: Date;
  deletedAt?: Date | null;
}
