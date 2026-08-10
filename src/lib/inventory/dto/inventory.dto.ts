export interface InventoryListItemDTO {
  id: string;
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
  updatedAt: Date;
}
