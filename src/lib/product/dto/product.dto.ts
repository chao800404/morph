import type { ProductMetadata, ProductStatus } from "@/db/product.schema";
import type { ProductOptionDTO } from "./product-option.dto";
import type { ProductVariantDTO } from "./product-variant.dto";


export interface ProductDTO {
  id: string;
  title: string;
  handle: string;
  subtitle: string | null;
  description: string | null;
  status: ProductStatus;
  collectionId: string | null;
  thumbnailAssetId: string | null;
  metadata: ProductMetadata;
  createdBy: string;
  updatedBy: string;
  createdAt: Date;
  updatedAt: Date;
}

/** A product with everything the detail view needs, in one shape. */
export interface ProductDetailDTO extends ProductDTO {
  options: ProductOptionDTO[];
  variants: ProductVariantDTO[];
  /** Gallery asset ids in display order. */
  assetIds: string[];
}

export interface CreateProductDTO {
  title: string;
  handle: string;
  subtitle?: string | null;
  description?: string | null;
  status?: ProductStatus;
  collectionId?: string | null;
  thumbnailAssetId?: string | null;
  metadata?: ProductMetadata;
  createdBy: string;
  updatedBy: string;
}

export interface ProductInsertDTO extends CreateProductDTO {
  id: string;
  createdAt?: Date;
  updatedAt?: Date;
}

export interface UpdateProductDTO {
  title?: string;
  handle?: string;
  subtitle?: string | null;
  description?: string | null;
  status?: ProductStatus;
  collectionId?: string | null;
  thumbnailAssetId?: string | null;
  metadata?: ProductMetadata;
  updatedBy: string;
}
