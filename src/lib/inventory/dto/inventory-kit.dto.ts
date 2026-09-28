export interface VariantInventoryKitItemDTO {
  inventoryItemId: string;
  title: string | null;
  sku: string | null;
  unitOfMeasure: string | null;
  requiredQuantity: number;
  stockedQuantity: number;
  reservedQuantity: number;
  incomingQuantity: number;
  availableQuantity: number;
}

export interface VariantInventoryKitItemInput {
  inventoryItemId: string;
  requiredQuantity: number;
}
