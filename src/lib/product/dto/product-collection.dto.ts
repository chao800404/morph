import type { ProductMetadata } from "@/db/product.schema";

export interface CreateProductCollectionDTO {
  title: string;
  handle: string;
  description?: string | null;
  createdBy: string;
  updatedBy: string;
}

export interface ProductCollectionDTO {
  id: string;
  title: string;
  handle: string;
  description: string | null;
  /** Set by whatever system owns this collection upstream. */
  externalId: string | null;
  /** Free-form store-defined data; never trusted to hold anything private. */
  metadata: ProductMetadata;
  createdBy: string;
  updatedBy: string;
  createdAt: Date;
  updatedAt: Date;
}

export interface ProductCollectionInsertDTO extends CreateProductCollectionDTO {
  id: string;
  createdAt?: Date;
  updatedAt?: Date;
}

export interface UpdateProductCollectionDTO {
  metadata?: ProductMetadata;
  title?: string;
  handle?: string;
  description?: string | null;
  updatedBy: string;
}
