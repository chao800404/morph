export interface StoreProductListItemDTO {
  id: string;
  title: string;
  handle: string;
  subtitle: string | null;
  description: string | null;
  thumbnailUrl: string | null;
  collectionId: string | null;
  collectionTitle: string | null;
  updatedAt: string;
}

export interface StoreProductDetailDTO extends StoreProductListItemDTO {
  assets: Array<{ id: string; name: string; url: string }>;
  options: Array<{
    id: string;
    title: string;
    values: Array<{ id: string; value: string }>;
  }>;
  variants: Array<{
    id: string;
    title: string;
    sku: string | null;
    allowBackorder: boolean;
    availableQuantity: number;
    optionValueIds: string[];
    assets: Array<{ id: string; name: string; url: string }>;
    price: {
      currencyCode: string;
      amount: number;
      originalAmount: number;
      priceListType: "sale" | "override" | null;
    } | null;
  }>;
}

export interface StoreCollectionDTO {
  id: string;
  title: string;
  handle: string;
  description: string | null;
}

export interface StoreCategoryDTO {
  id: string;
  name: string;
  handle: string;
  description: string;
  parentCategoryId: string | null;
  rank: number;
}
