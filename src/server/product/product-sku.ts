import { productVariantDal } from "@/lib/product/dal/product-variant.dal";
import { createUniqueSku } from "@/lib/product/sku";
import { getConfig } from "../get-config";

export const resolveVariantSku = async ({
  sku,
  productHandle,
  variantTitle,
  optionValues,
  index,
  reserved = new Set<string>(),
}: {
  sku?: string | null;
  productHandle: string;
  variantTitle: string;
  optionValues: string[];
  index: number;
  reserved?: Set<string>;
}): Promise<string | null> => {
  const manual = sku?.trim() || null;
  if (manual) {
    if (
      reserved.has(manual) ||
      (await productVariantDal.findIdentifierConflict({ sku: manual })) ===
        "sku"
    ) {
      throw new Error(`Another variant already uses the SKU "${manual}"`);
    }
    reserved.add(manual);
    return manual;
  }

  const generated = await createUniqueSku(
    {
      product: productHandle,
      variant: variantTitle,
      options: optionValues,
      index,
    },
    getConfig().server.products?.sku,
    async (candidate) =>
      reserved.has(candidate) ||
      (await productVariantDal.findIdentifierConflict({ sku: candidate })) ===
        "sku",
  );
  if (generated) reserved.add(generated);
  return generated;
};
