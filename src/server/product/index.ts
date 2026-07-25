// Catalogue read operations
export { getProduct, listProducts } from "./list-products.serverFn";
export { listCollections } from "./collections.serverFn";
export { listOptionTemplates } from "./option-templates.serverFn";

// Product mutations
export { createProduct } from "./create-product.serverFn";
export { deleteProducts, updateProduct } from "./update-product.serverFn";

// Variant mutations
export { deleteVariants, updateVariant } from "./variants.serverFn";

// Collection mutations
export {
  createCollection,
  deleteCollections,
  updateCollection,
} from "./collections.serverFn";

// Reusable option definitions
export {
  createOptionTemplate,
  deleteOptionTemplates,
  updateOptionTemplate,
} from "./option-templates.serverFn";
