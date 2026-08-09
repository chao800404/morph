export interface InventoryListItemDTO {
  id: string;
  title: string | null;
  sku: string | null;
  variantCount: number;
  stockedQuantity: number;
  reservedQuantity: number;
  incomingQuantity: number;
  availableQuantity: number;
  updatedAt: Date;
}
