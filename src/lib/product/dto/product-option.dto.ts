import type { ProductMetadata } from "@/db/product.schema";

/**
 * Product options.
 *
 * Options are global by default and reusable across products — that shared list
 * is what the Options page manages. An option created for one product only is
 * marked `isExclusive` and stays out of that list. Both live in the same table,
 * so there is one CRUD path rather than two parallel ones.
 */

export interface ProductOptionValueDTO {
  id: string;
  optionId: string;
  value: string;
  rank: number;
  metadata: ProductMetadata | null;
}

export interface ProductOptionDTO {
  id: string;
  title: string;
  isExclusive: boolean;
  rank: number;
  metadata: ProductMetadata | null;
  values: ProductOptionValueDTO[];
  createdBy: string;
  updatedBy: string;
  createdAt: Date;
  updatedAt: Date;
}

export interface CreateProductOptionDTO {
  title: string;
  rank?: number;
  isExclusive?: boolean;
  metadata?: ProductMetadata | null;
  /** Values in display order. */
  values: string[];
  createdBy: string;
  updatedBy: string;
}

export interface ProductOptionInsertDTO extends CreateProductOptionDTO {
  id: string;
  createdAt?: Date;
  updatedAt?: Date;
}

export interface UpdateProductOptionDTO {
  title?: string;
  rank?: number;
  metadata?: ProductMetadata | null;
  /** When present, replaces the option's whole value list. */
  values?: string[];
  updatedBy: string;
}

/**
 * How a product adopts an option: either reuse one from the shared library and
 * pick which of its values apply, or define an option exclusive to the product.
 */
export type ProductOptionSelectionDTO =
  | { optionId: string; valueIds: string[] }
  | { title: string; values: string[] };
