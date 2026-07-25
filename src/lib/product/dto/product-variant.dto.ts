export interface ProductVariantPriceDTO {
  id: string;
  variantId: string;
  currencyCode: string;
  /** Integer in the currency's minor unit. */
  amount: number;
}

export interface CreateProductVariantPriceDTO {
  currencyCode: string;
  amount: number;
}

export interface ProductVariantDTO {
  id: string;
  productId: string;
  title: string;
  sku: string | null;
  barcode: string | null;
  rank: number;
  manageInventory: boolean;
  allowBackorder: boolean;
  inventoryQuantity: number;
  weight: number | null;
  length: number | null;
  width: number | null;
  height: number | null;
  /** Option values this variant is defined by, one per option axis. */
  optionValueIds: string[];
  prices: ProductVariantPriceDTO[];
  createdBy: string;
  updatedBy: string;
  createdAt: Date;
  updatedAt: Date;
}

export interface CreateProductVariantDTO {
  title: string;
  sku?: string | null;
  barcode?: string | null;
  rank?: number;
  manageInventory?: boolean;
  allowBackorder?: boolean;
  inventoryQuantity?: number;
  weight?: number | null;
  length?: number | null;
  width?: number | null;
  height?: number | null;
  optionValueIds?: string[];
  prices?: CreateProductVariantPriceDTO[];
  createdBy: string;
  updatedBy: string;
}

export interface ProductVariantInsertDTO extends CreateProductVariantDTO {
  id: string;
  productId: string;
  createdAt?: Date;
  updatedAt?: Date;
}

export interface UpdateProductVariantDTO {
  title?: string;
  sku?: string | null;
  barcode?: string | null;
  rank?: number;
  manageInventory?: boolean;
  allowBackorder?: boolean;
  inventoryQuantity?: number;
  weight?: number | null;
  length?: number | null;
  width?: number | null;
  height?: number | null;
  /** When present, replaces the variant's full price list. */
  prices?: CreateProductVariantPriceDTO[];
  updatedBy: string;
}
