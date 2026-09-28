import { productDal } from "@/lib/product/dal/product.dal";
import { productVariantDal } from "@/lib/product/dal/product-variant.dal";
import type { ProductImportGroup, ProductImportRow } from "./product-import.csv";
import {
  createProductInputSchema,
  createVariantInputSchema,
  updateProductInputSchema,
  updateVariantInputSchema,
} from "@/lib/validations/product";
import { productWriteService } from "@/lib/product/service/product-write.service";
import { productVariantWriteService } from "@/lib/product/service/product-variant-write.service";
import type { ProductImportGroupResult } from "./product-import.service";

const valueForOption = (row: ProductImportRow, title: string) =>
  row.variant.optionValues?.find(
    (option) => option.name.trim().toLowerCase() === title.trim().toLowerCase(),
  )?.value;

const optionValueIds = (
  row: ProductImportRow,
  product: NonNullable<Awaited<ReturnType<typeof productDal.findDetail>>>,
) => {
  const options = row.variant.optionValues ?? [];
  if (options.length === 0) return [];
  const ids: string[] = [];
  for (const selection of options) {
    const option = product.options.find(
      (candidate) => candidate.title.trim().toLowerCase() === selection.name.trim().toLowerCase(),
    );
    const value = option?.values.find(
      (candidate) => candidate.value.trim().toLowerCase() === selection.value.trim().toLowerCase(),
    );
    if (!value) return null;
    ids.push(value.id);
  }
  return ids;
};

const createProductFromGroup = async (
  group: ProductImportGroup,
  actorId: string,
  maxAssets: number,
): Promise<ProductImportGroupResult> => {
  const first = group.rows[0];
  if (!first?.product.title) return { success: false, message: "A new product needs a title" };
  if (group.rows.some((row) => row.productId || row.variantId)) {
    return { success: false, message: "Product or variant IDs can only update existing products" };
  }

  const optionTitles = first.variant.optionValues?.map((option) => option.name) ?? [];
  const options = optionTitles.map((title) => ({
    title,
    values: [...new Set(group.rows.flatMap((row) => {
      const value = valueForOption(row, title);
      return value ? [value] : [];
    }))],
  }));
  const variants = group.rows.map((row) => ({
    title: row.variant.title ?? row.variant.optionValues?.map((option) => option.value).join(" / ") ?? "Default",
    ...(row.variant.sku !== undefined ? { sku: row.variant.sku } : {}),
    ...(row.variant.barcode !== undefined ? { barcode: row.variant.barcode } : {}),
    manageInventory: row.variant.manageInventory ?? true,
    allowBackorder: row.variant.allowBackorder ?? false,
    inventoryQuantity: row.variant.inventoryQuantity ?? 0,
    optionValues: optionTitles.map((title) => valueForOption(row, title) ?? ""),
    prices: row.variant.prices ?? [],
    ...(row.variant.metadata !== undefined ? { metadata: row.variant.metadata } : {}),
  }));
  const input = createProductInputSchema(maxAssets).safeParse({
    title: first.product.title,
    ...(first.product.handle !== undefined ? { handle: first.product.handle } : {}),
    ...(first.product.subtitle !== undefined ? { subtitle: first.product.subtitle } : {}),
    ...(first.product.description !== undefined ? { description: first.product.description } : {}),
    ...(first.product.status !== undefined ? { status: first.product.status } : {}),
    ...(first.product.collectionId !== undefined ? { collectionId: first.product.collectionId } : {}),
    ...(first.product.typeValue !== undefined ? { typeValue: first.product.typeValue } : {}),
    tagValues: first.product.tagValues ?? [],
    categoryIds: first.product.categoryIds ?? [],
    salesChannelIds: first.product.salesChannelIds ?? [],
    discountable: first.product.discountable ?? true,
    assetIds: first.product.assetIds ?? [],
    ...(first.product.metadata !== undefined ? { metadata: first.product.metadata } : {}),
    options,
    prices: [],
    variants,
  });
  if (!input.success) {
    return {
      success: false,
      message: input.error.issues.map((issue) => issue.message).join("; ").slice(0, 450),
    };
  }
  const result = await productWriteService.create(input.data, actorId);
  return result.success
    ? { success: true, action: "created" }
    : { success: false, message: result.message };
};

const updateProductFromGroup = async (
  group: ProductImportGroup,
  actorId: string,
  maxAssets: number,
): Promise<ProductImportGroupResult> => {
  const first = group.rows[0];
  if (!group.productId || !first) return { success: false, message: "Product ID is required for an update" };
  const existing = await productDal.findDetail(group.productId);
  if (!existing) return { success: false, message: "Product was not found" };

  const updateInput = updateProductInputSchema(maxAssets).safeParse({
    id: group.productId,
    ...(first.product.title !== undefined ? { title: first.product.title } : {}),
    ...(first.product.handle !== undefined ? { handle: first.product.handle } : {}),
    ...(first.product.subtitle !== undefined ? { subtitle: first.product.subtitle } : {}),
    ...(first.product.description !== undefined ? { description: first.product.description } : {}),
    ...(first.product.status !== undefined ? { status: first.product.status } : {}),
    ...(first.product.collectionId !== undefined ? { collectionId: first.product.collectionId } : {}),
    ...(first.product.typeValue !== undefined ? { typeValue: first.product.typeValue } : {}),
    ...(first.product.tagValues !== undefined ? { tagValues: first.product.tagValues } : {}),
    ...(first.product.categoryIds !== undefined ? { categoryIds: first.product.categoryIds } : {}),
    ...(first.product.salesChannelIds !== undefined ? { salesChannelIds: first.product.salesChannelIds } : {}),
    ...(first.product.discountable !== undefined ? { discountable: first.product.discountable } : {}),
    ...(first.product.assetIds !== undefined ? { assetIds: first.product.assetIds } : {}),
    ...(first.product.metadata !== undefined ? { metadata: first.product.metadata } : {}),
  });
  if (!updateInput.success) {
    return {
      success: false,
      message: updateInput.error.issues.map((issue) => issue.message).join("; ").slice(0, 450),
    };
  }
  const updatedProduct = await productWriteService.update(updateInput.data, actorId);
  if (!updatedProduct.success) return { success: false, message: updatedProduct.message };

  // Product fields are written once per group. Refresh the detail after that
  // write so option and media ownership checks use the current product state.
  const currentProduct = await productDal.findDetail(group.productId);
  if (!currentProduct) return { success: false, message: "Product disappeared during import" };

  for (const row of group.rows) {
    const selectedValues = optionValueIds(row, currentProduct);
    if (selectedValues === null) {
      return { success: false, message: `Variant row ${row.row} references an option or value not on this product` };
    }
    if (row.variantId) {
      const existingVariant = await productVariantDal.findById(row.variantId);
      if (!existingVariant || existingVariant.productId !== group.productId) {
        return { success: false, message: `Variant row ${row.row} does not belong to this product` };
      }
      const variantInput = updateVariantInputSchema(maxAssets).safeParse({
        id: row.variantId,
        ...(row.variant.title !== undefined ? { title: row.variant.title } : {}),
        ...(row.variant.sku !== undefined ? { sku: row.variant.sku } : {}),
        ...(row.variant.barcode !== undefined ? { barcode: row.variant.barcode } : {}),
        ...(row.variant.manageInventory !== undefined ? { manageInventory: row.variant.manageInventory } : {}),
        ...(row.variant.allowBackorder !== undefined ? { allowBackorder: row.variant.allowBackorder } : {}),
        ...(row.variant.inventoryQuantity !== undefined ? { inventoryQuantity: row.variant.inventoryQuantity } : {}),
        ...(row.variant.metadata !== undefined ? { metadata: row.variant.metadata } : {}),
        ...(row.variant.prices !== undefined ? { prices: row.variant.prices } : {}),
        ...(row.variant.optionValues !== undefined ? { optionValueIds: selectedValues } : {}),
      });
      if (!variantInput.success) {
        return { success: false, message: variantInput.error.issues.map((issue) => issue.message).join("; ").slice(0, 450) };
      }
      const updatedVariant = await productVariantWriteService.update(variantInput.data, actorId);
      if (!updatedVariant.success) return { success: false, message: updatedVariant.message };
    } else {
      const variantInput = createVariantInputSchema(maxAssets).safeParse({
        productId: group.productId,
        title: row.variant.title ?? row.variant.optionValues?.map((option) => option.value).join(" / ") ?? "Default",
        ...(row.variant.sku !== undefined ? { sku: row.variant.sku } : {}),
        ...(row.variant.barcode !== undefined ? { barcode: row.variant.barcode } : {}),
        manageInventory: row.variant.manageInventory ?? true,
        allowBackorder: row.variant.allowBackorder ?? false,
        inventoryQuantity: row.variant.inventoryQuantity ?? 0,
        optionValueIds: selectedValues,
        prices: row.variant.prices ?? [],
        assetIds: [],
        ...(row.variant.metadata !== undefined ? { metadata: row.variant.metadata } : {}),
      });
      if (!variantInput.success) {
        return { success: false, message: variantInput.error.issues.map((issue) => issue.message).join("; ").slice(0, 450) };
      }
      const createdVariant = await productVariantWriteService.create(variantInput.data, actorId);
      if (!createdVariant.success) return { success: false, message: createdVariant.message };
    }
  }
  return { success: true, action: "updated" };
};

export const createProductImportGroupApplier = (maxAssets: number) =>
  async (group: ProductImportGroup, actorId: string): Promise<ProductImportGroupResult> =>
    group.productId
      ? updateProductFromGroup(group, actorId, maxAssets)
      : createProductFromGroup(group, actorId, maxAssets);
