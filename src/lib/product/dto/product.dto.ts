import type { ProductMetadata, ProductStatus } from "@/db/product.schema";
import type { ProductOptionDTO } from "./product-option.dto";
import type { ProductVariantDTO } from "./product-variant.dto";
import type { SalesChannelDTO } from "@/lib/sales-channel/dto/sales-channel.dto";


export interface ProductDTO {
  id: string;
  title: string;
  handle: string;
  subtitle: string | null;
  description: string | null;
  status: ProductStatus;
  collectionId: string | null;
  typeId: string | null;
  discountable: boolean;
  thumbnailAssetId: string | null;
  // Shipping and customs attributes. Carried on the DTO because the detail page
  // shows them; variants may override each one.
  weight: number | null;
  length: number | null;
  width: number | null;
  height: number | null;
  originCountry: string | null;
  hsCode: string | null;
  midCode: string | null;
  material: string | null;
  metadata: ProductMetadata;
  createdBy: string;
  updatedBy: string;
  createdAt: Date;
  updatedAt: Date;
}

/** Product list projection used by the dashboard table. */
export interface ProductListItemDTO extends ProductDTO {
  thumbnailUrl: string | null;
  collectionTitle: string | null;
  typeValue: string | null;
  salesChannels: Array<{ id: string; name: string }>;
  variantCount: number;
}

/** A product with everything the detail view needs, in one shape. */
export interface ProductDetailDTO extends ProductDTO {
  options: ProductOptionDTO[];
  variants: ProductVariantDTO[];
  /** Gallery asset ids in display order. */
  assetIds: string[];
  tagIds: string[];
  categoryIds: string[];
  /**
   * The same links again, resolved to what the detail page draws.
   *
   * Names travel with the record rather than being looked up per card: the
   * alternative is five more round trips on a page that already has one, and
   * each card would flash its own loading state.
   */
  assets: ProductAssetDTO[];
  collectionTitle: string | null;
  typeValue: string | null;
  tags: Array<{ id: string; value: string }>;
  categories: Array<{ id: string; name: string }>;
  salesChannels: SalesChannelDTO[];
  salesChannelIds: string[];
}

/** A gallery image, in display order. */
export interface ProductAssetDTO {
  id: string;
  name: string;
  url: string;
}

export interface CreateProductDTO {
  title: string;
  handle: string;
  subtitle?: string | null;
  description?: string | null;
  status?: ProductStatus;
  collectionId?: string | null;
  typeId?: string | null;
  discountable?: boolean;
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
  typeId?: string | null;
  discountable?: boolean;
  thumbnailAssetId?: string | null;
  // Shipping and customs. The columns existed and the detail page read them,
  // but nothing could write them until now.
  weight?: number | null;
  length?: number | null;
  width?: number | null;
  height?: number | null;
  originCountry?: string | null;
  hsCode?: string | null;
  midCode?: string | null;
  material?: string | null;
  metadata?: ProductMetadata;
  updatedBy: string;
}
