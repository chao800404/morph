import type { InventoryExportFilters } from "../dto/inventory-export.dto";
import type {
  CommerceExportExecution,
  CommerceExportFile,
  CommerceExportR2Bucket,
  CommerceExportStorage,
  VersionedCommerceExportExecution,
} from "@/lib/commerce-export/storage/commerce-export-storage";

export {
  commerceExportKindSchema,
  R2CommerceExportStorage,
  R2CommerceExportStorage as R2InventoryExportStorage,
} from "@/lib/commerce-export/storage/commerce-export-storage";
export type {
  CommerceExportExecution,
  CommerceExportFile,
  CommerceExportKind,
  CommerceExportR2Bucket,
  CommerceExportStorage,
  VersionedCommerceExportExecution,
} from "@/lib/commerce-export/storage/commerce-export-storage";

/** Compatibility aliases retained for existing inventory export callers. */
export type InventoryExportExecution<TFilters = InventoryExportFilters> =
  CommerceExportExecution<TFilters>;
export type VersionedInventoryExportExecution =
  VersionedCommerceExportExecution;
export type InventoryExportFile = CommerceExportFile;
export type InventoryExportStorage = CommerceExportStorage;
export type InventoryExportR2Bucket = CommerceExportR2Bucket;
