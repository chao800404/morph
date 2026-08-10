import {
  createVariant,
  deleteVariants,
  updateVariant,
} from "@/server/product/variants.serverFn";
import type { AssetActionResult } from "@/lib/asset/action-result";
import {
  createCollection,
  deleteCollections,
  updateCollection,
} from "@/server/product/collections.serverFn";
import {
  createProductCategory,
  deleteProductCategories,
  updateProductCategory,
} from "@/server/product/categories.serverFn";
import {
  setProductOptions,
  createProductOption,
  deleteProductOptions,
  updateProductOption,
} from "@/server/product/options.serverFn";
import {
  deleteProducts,
  updateProduct,
} from "@/server/product/update-product.serverFn";
import { setProductSalesChannels } from "@/server/sales-channel/sales-channels.serverFn";

/**
 * FormData adapters for the shared dashboard dialogs.
 *
 * The Create/Edit/Info windows submit a native `FormData`, while the catalogue
 * server functions take typed JSON. Converting here keeps the server functions
 * a clean API surface instead of bending them to the dialog's transport, and
 * keeps the parsing in one place rather than in each page.
 */

const text = (data: FormData, key: string): string | undefined => {
  const value = data.get(key);
  return typeof value === "string" && value.trim() !== ""
    ? value.trim()
    : undefined;
};

const idList = (data: FormData, key: string): string[] => {
  const raw = data.get(key);
  if (typeof raw !== "string") return [];
  try {
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed)
      ? parsed.filter((id): id is string => typeof id === "string")
      : [];
  } catch {
    return [];
  }
};

/**
 * The server functions return a union whose `errors` shape differs per branch,
 * so optional keys are dropped rather than widened.
 */
const toActionResult = (result: {
  success: boolean;
  message: string;
  errors?: Partial<Record<string, string[]>>;
}): AssetActionResult => ({
  success: result.success,
  message: result.message,
  errors: result.errors
    ? Object.fromEntries(
        Object.entries(result.errors).filter(
          (entry): entry is [string, string[]] => entry[1] !== undefined,
        ),
      )
    : undefined,
});

export const updateProductAction = async ({
  data,
}: {
  data: FormData;
}): Promise<AssetActionResult> => {
  const id = text(data, "id");
  if (!id) {
    return { success: false, message: "Missing product ID" };
  }

  const status = text(data, "status");

  return toActionResult(
    await updateProduct({
      data: {
        id,
        title: text(data, "title"),
        handle: text(data, "handle"),
        subtitle: text(data, "subtitle") ?? null,
        description: text(data, "description") ?? null,
        status:
          status === "draft" || status === "published" || status === "archived"
            ? status
            : undefined,
        material: text(data, "material") ?? null,
        // An unchecked switch submits nothing, so absence is false rather than
        // "leave alone" — this form always renders the switch.
        discountable: data.get("discountable") === "on",
      },
    }),
  );
};

/**
 * Shipping and customs.
 *
 * Blank clears the field rather than leaving it: the form always renders every
 * one of them, so an empty box is the author saying "no value", not "unchanged".
 *
 * Not rounded — the columns are `real`, because a carrier's rate table takes
 * 12.5 mm and rounding it would quietly change what is shipped.
 */
const measurement = (data: FormData, key: string): number | null => {
  const raw = text(data, key);
  if (raw === undefined) return null;
  const value = Number(raw);
  return Number.isFinite(value) && value >= 0 ? value : null;
};

export const updateProductAttributesAction = async ({
  data,
}: {
  data: FormData;
}): Promise<AssetActionResult> => {
  const id = text(data, "id");
  if (!id) {
    return { success: false, message: "Missing product ID" };
  }

  return toActionResult(
    await updateProduct({
      data: {
        id,
        weight: measurement(data, "weight"),
        length: measurement(data, "length"),
        width: measurement(data, "width"),
        height: measurement(data, "height"),
        originCountry: text(data, "originCountry")?.toUpperCase() ?? null,
        hsCode: text(data, "hsCode") ?? null,
        midCode: text(data, "midCode") ?? null,
      },
    }),
  );
};

/**
 * Where the product sits in the catalogue.
 *
 * Separate from the details form for the same reason metadata is: each field
 * here replaces a whole link set, so a form that did not render them would
 * clear them by omission.
 */
export const updateProductOrganizationAction = async ({
  data,
}: {
  data: FormData;
}): Promise<AssetActionResult> => {
  const id = text(data, "id");
  if (!id) {
    return { success: false, message: "Missing product ID" };
  }

  const collectionId = text(data, "collectionId");

  const organizationResult = await updateProduct({
    data: {
      id,
      collectionId:
        !collectionId || collectionId === NO_COLLECTION ? null : collectionId,
      typeValue: valueList(data, "typeValue").at(0) ?? null,
      tagValues: valueList(data, "tagValues"),
      categoryIds: idList(data, "categoryIds"),
    },
  });
  if (!organizationResult.success) {
    return toActionResult(organizationResult);
  }

  return toActionResult(
    await setProductSalesChannels({
      data: { productId: id, salesChannelIds: idList(data, "salesChannelIds") },
    }),
  );
};

/** The value the Collection select uses for "none"; Zod would reject "". */
export const NO_COLLECTION = "__none__";

export const updateProductMediaAction = async ({
  data,
}: {
  data: FormData;
}): Promise<AssetActionResult> => {
  const id = text(data, "id");
  if (!id) {
    return { success: false, message: "Missing product ID" };
  }

  const media = readAssetIds(data, "assets");
  if (!media.ok) return media.error;

  return toActionResult(
    await updateProduct({
      // The order is the payload: `setAssets` writes it as `rank` and takes
      // the first entry as the thumbnail.
      data: { id, assetIds: media.assetIds },
    }),
  );
};

const readAssetIds = (
  data: FormData,
  name: string,
):
  | { ok: true; assetIds: string[] }
  | { ok: false; error: AssetActionResult } => {
  const raw = data.get(name);
  let assetIds: string[] = [];
  if (typeof raw === "string" && raw) {
    try {
      const parsed: unknown = JSON.parse(raw);
      assetIds = Array.isArray(parsed)
        ? parsed.flatMap((item) =>
            typeof item === "object" &&
            item !== null &&
            typeof (item as { id?: unknown }).id === "string"
              ? [(item as { id: string }).id]
              : [],
          )
        : [];
    } catch {
      return {
        ok: false,
        error: { success: false, message: "Could not read the selected media" },
      };
    }
  }
  return { ok: true, assetIds };
};

export const deleteProductsAction = async ({
  data,
}: {
  data: FormData;
}): Promise<AssetActionResult> => {
  const ids = idList(data, "productIds");
  if (ids.length === 0) {
    return { success: false, message: "No products selected" };
  }
  return toActionResult(await deleteProducts({ data: { ids } }));
};

export const createCollectionAction = async ({
  data,
}: {
  data: FormData;
}): Promise<AssetActionResult> => {
  const title = text(data, "title");
  if (!title) {
    return {
      success: false,
      message: "Title is required",
      errors: { title: ["Title is required"] },
    };
  }

  return toActionResult(
    await createCollection({
      data: {
        title,
        handle: text(data, "handle"),
        description: text(data, "description") ?? null,
      },
    }),
  );
};

export const updateCollectionAction = async ({
  data,
}: {
  data: FormData;
}): Promise<AssetActionResult> => {
  const id = text(data, "id");
  if (!id) {
    return { success: false, message: "Missing collection ID" };
  }

  return toActionResult(
    await updateCollection({
      data: {
        id,
        title: text(data, "title"),
        handle: text(data, "handle"),
        description: text(data, "description") ?? null,
      },
    }),
  );
};

export const deleteCollectionsAction = async ({
  data,
}: {
  data: FormData;
}): Promise<AssetActionResult> => {
  const ids = idList(data, "collectionIds");
  if (ids.length === 0) {
    return { success: false, message: "No collections selected" };
  }
  return toActionResult(await deleteCollections({ data: { ids } }));
};

/** `option-values` fields submit their tags as a JSON array string. */
const valueList = (data: FormData, key: string): string[] => idList(data, key);

export const createProductOptionAction = async ({
  data,
}: {
  data: FormData;
}): Promise<AssetActionResult> => {
  const title = text(data, "title");
  const values = valueList(data, "values");

  if (!title) {
    return {
      success: false,
      message: "Title is required",
      errors: { title: ["Title is required"] },
    };
  }
  if (values.length === 0) {
    return {
      success: false,
      message: "Add at least one value",
      errors: { values: ["Add at least one value"] },
    };
  }

  return toActionResult(await createProductOption({ data: { title, values } }));
};

export const updateProductOptionAction = async ({
  data,
}: {
  data: FormData;
}): Promise<AssetActionResult> => {
  const id = text(data, "id");
  if (!id) {
    return { success: false, message: "Missing option ID" };
  }

  const values = valueList(data, "values");
  if (values.length === 0) {
    return {
      success: false,
      message: "Add at least one value",
      errors: { values: ["Add at least one value"] },
    };
  }

  return toActionResult(
    await updateProductOption({
      data: { id, title: text(data, "title"), values },
    }),
  );
};

export const deleteProductOptionsAction = async ({
  data,
}: {
  data: FormData;
}): Promise<AssetActionResult> => {
  const ids = idList(data, "optionIds");
  if (ids.length === 0) {
    return { success: false, message: "No options selected" };
  }
  return toActionResult(await deleteProductOptions({ data: { ids } }));
};

export const deleteProductCategoriesAction = async ({
  data,
}: {
  data: FormData;
}): Promise<AssetActionResult> => {
  const ids = idList(data, "categoryIds");
  if (ids.length === 0) {
    return { success: false, message: "No categories selected" };
  }
  return toActionResult(await deleteProductCategories({ data: { ids } }));
};

/** Category forms submit `status` and `visibility`; the API takes booleans. */
const categoryFlags = (data: FormData) => ({
  isActive: text(data, "status") === "active",
  isInternal: text(data, "visibility") === "internal",
});

export const createProductCategoryAction = async ({
  data,
}: {
  data: FormData;
}): Promise<AssetActionResult> => {
  const name = text(data, "name");
  if (!name) {
    return {
      success: false,
      message: "Name is required",
      errors: { name: ["Name is required"] },
    };
  }

  const parentCategoryId = text(data, "parentCategoryId");

  return toActionResult(
    await createProductCategory({
      data: {
        name,
        handle: text(data, "handle"),
        description: text(data, "description") ?? "",
        parentCategoryId:
          parentCategoryId && parentCategoryId !== "__root__"
            ? parentCategoryId
            : null,
        ...categoryFlags(data),
      },
    }),
  );
};

export const updateProductCategoryAction = async ({
  data,
}: {
  data: FormData;
}): Promise<AssetActionResult> => {
  const id = text(data, "id");
  if (!id) {
    return { success: false, message: "Missing category ID" };
  }

  return toActionResult(
    await updateProductCategory({
      data: {
        id,
        name: text(data, "name"),
        handle: text(data, "handle"),
        description: text(data, "description") ?? "",
        ...categoryFlags(data),
      },
    }),
  );
};

/**
 * The metadata field submits a JSON object string; this reads it back.
 *
 * Returns `null` when the payload is unreadable so the caller can report it
 * rather than silently saving an empty object over the store's data.
 */
const readMetadata = (data: FormData): Record<string, string> | null => {
  const raw = data.get("metadata");
  if (typeof raw !== "string" || raw === "") return {};

  try {
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return {};
    }
    return Object.fromEntries(
      Object.entries(parsed as Record<string, unknown>).map(([key, value]) => [
        key,
        String(value),
      ]),
    );
  } catch {
    return null;
  }
};

const METADATA_READ_ERROR: AssetActionResult = {
  success: false,
  message: "Metadata could not be read",
  errors: { metadata: ["Metadata could not be read"] },
};

/**
 * Metadata is submitted on its own so the two edit forms cannot overwrite each
 * other: the details form has no metadata field, and sending `undefined` for
 * it would be indistinguishable from clearing it.
 */
export const updateProductCategoryMetadataAction = async ({
  data,
}: {
  data: FormData;
}): Promise<AssetActionResult> => {
  const id = text(data, "id");
  if (!id) {
    return { success: false, message: "Missing category ID" };
  }

  const metadata = readMetadata(data);
  if (!metadata) return METADATA_READ_ERROR;

  return toActionResult(
    await updateProductCategory({ data: { id, metadata } }),
  );
};

export const updateCollectionMetadataAction = async ({
  data,
}: {
  data: FormData;
}): Promise<AssetActionResult> => {
  const id = text(data, "id");
  if (!id) {
    return { success: false, message: "Missing collection ID" };
  }

  const metadata = readMetadata(data);
  if (!metadata) return METADATA_READ_ERROR;

  return toActionResult(await updateCollection({ data: { id, metadata } }));
};

export const updateProductOptionMetadataAction = async ({
  data,
}: {
  data: FormData;
}): Promise<AssetActionResult> => {
  const id = text(data, "id");
  if (!id) {
    return { success: false, message: "Missing option ID" };
  }

  const metadata = readMetadata(data);
  if (!metadata) return METADATA_READ_ERROR;

  return toActionResult(await updateProductOption({ data: { id, metadata } }));
};

export const updateProductMetadataAction = async ({
  data,
}: {
  data: FormData;
}): Promise<AssetActionResult> => {
  const id = text(data, "id");
  if (!id) {
    return { success: false, message: "Missing product ID" };
  }

  const metadata = readMetadata(data);
  if (!metadata) return METADATA_READ_ERROR;

  return toActionResult(await updateProduct({ data: { id, metadata } }));
};

/**
 * `price-<code>` keys in major units, one per store currency, because the form
 * renders a field each and `FormData` has no nested shape. A blank or zero
 * field drops the currency rather than storing a free variant.
 */
const readPrices = (data: FormData) => {
  const prices: Array<{ currencyCode: string; amount: number }> = [];
  for (const [key, value] of data.entries()) {
    if (
      !key.startsWith("price-") ||
      key.startsWith("price-decimals-") ||
      typeof value !== "string"
    )
      continue;
    const currencyCode = key.slice("price-".length);
    const decimalDigits = Number(
      text(data, `price-decimals-${currencyCode}`) ?? "2",
    );
    const amount = Math.round(
      Number(value) *
        10 **
          (Number.isInteger(decimalDigits) && decimalDigits >= 0
            ? decimalDigits
            : 2),
    );
    if (!Number.isFinite(amount) || amount <= 0) continue;
    prices.push({ currencyCode, amount });
  }
  return prices;
};

/** One `option-<optionId>` select per axis, each holding a value id. */
const readOptionValueIds = (data: FormData) =>
  [...data.entries()].flatMap(([key, value]) =>
    key.startsWith("option-") && typeof value === "string" && value
      ? [value]
      : [],
  );

const readQuantity = (data: FormData) => {
  const quantity = Number(text(data, "inventoryQuantity") ?? "0");
  return Number.isFinite(quantity) ? Math.max(0, Math.floor(quantity)) : 0;
};

/** The full option set the author left ticked; the server diffs it. */
export const setProductOptionsAction = async ({
  data,
}: {
  data: FormData;
}): Promise<AssetActionResult> => {
  const productId = text(data, "productId");
  if (!productId) {
    return { success: false, message: "Missing product ID" };
  }

  // `{ optionId, valueIds }` pairs: the server rejects an option with no
  // values, and only the page has the library loaded to expand them.
  const raw = data.get("optionSelections");
  let options: Array<{ optionId: string; valueIds: string[] }> = [];
  if (typeof raw === "string" && raw) {
    try {
      const parsed: unknown = JSON.parse(raw);
      options = Array.isArray(parsed)
        ? (parsed as Array<{ optionId: string; valueIds: string[] }>)
        : [];
    } catch {
      return { success: false, message: "Could not read the selected options" };
    }
  }

  // An empty set is legitimate: it detaches every axis from a product that has
  // no variants using them.
  return toActionResult(
    await setProductOptions({
      data: {
        productId,
        options,
        // Only ever set by the confirmation, which states the count first.
        removeVariantsInUse: data.get("removeVariantsInUse") === "on",
      },
    }),
  );
};

export const createVariantAction = async ({
  data,
}: {
  data: FormData;
}): Promise<AssetActionResult> => {
  const productId = text(data, "productId");
  if (!productId) {
    return { success: false, message: "Missing product ID" };
  }
  const media = readAssetIds(data, "assets");
  if (!media.ok) return media.error;

  return toActionResult(
    await createVariant({
      data: {
        productId,
        title: text(data, "title") ?? "",
        sku: text(data, "sku") ?? null,
        barcode: text(data, "barcode") ?? null,
        weight: measurement(data, "weight"),
        length: measurement(data, "length"),
        width: measurement(data, "width"),
        height: measurement(data, "height"),
        manageInventory: data.get("manageInventory") === "on",
        allowBackorder: data.get("allowBackorder") === "on",
        inventoryQuantity: readQuantity(data),
        optionValueIds: readOptionValueIds(data),
        prices: readPrices(data),
        assetIds: media.assetIds,
        metadata: {},
      },
    }),
  );
};

/**
 * One variant's own fields.
 *
 * Prices arrive as `price-<code>` keys in major units, because the form renders
 * one field per store currency and `FormData` has no nested shape. A blank or
 * zero field drops the currency rather than storing a free variant.
 */
export const updateVariantAction = async ({
  data,
}: {
  data: FormData;
}): Promise<AssetActionResult> => {
  const id = text(data, "id");
  if (!id) {
    return { success: false, message: "Missing variant ID" };
  }

  const quantity = readQuantity(data);
  const media = data.has("assets") ? readAssetIds(data, "assets") : null;
  if (media && !media.ok) return media.error;
  return toActionResult(
    await updateVariant({
      data: {
        id,
        title: text(data, "title"),
        sku: text(data, "sku") ?? null,
        barcode: text(data, "barcode") ?? null,
        // The variant's own shipping attributes, overriding the product's.
        // Blank clears rather than leaves unchanged, for the same reason the
        // product's attributes form does — see `measurement`.
        weight: measurement(data, "weight"),
        length: measurement(data, "length"),
        width: measurement(data, "width"),
        height: measurement(data, "height"),
        // Unchecked switches submit nothing; this form always renders both.
        manageInventory: data.get("manageInventory") === "on",
        allowBackorder: data.get("allowBackorder") === "on",
        inventoryQuantity: quantity,
        optionValueIds: readOptionValueIds(data),
        ...(media ? { assetIds: media.assetIds } : {}),
      },
    }),
  );
};

/** Base prices own a spreadsheet editor, so no unrelated variant field is sent. */
export const updateVariantPricingAction = async ({
  data,
}: {
  data: FormData;
}): Promise<AssetActionResult> => {
  const id = text(data, "id");
  if (!id) {
    return { success: false, message: "Missing variant ID" };
  }

  return toActionResult(
    await updateVariant({ data: { id, prices: readPrices(data) } }),
  );
};

/** Variant metadata owns a separate editor, matching every other detail card. */
export const updateVariantMetadataAction = async ({
  data,
}: {
  data: FormData;
}): Promise<AssetActionResult> => {
  const id = text(data, "id");
  if (!id) {
    return { success: false, message: "Missing variant ID" };
  }

  const metadata = readMetadata(data);
  if (!metadata) return METADATA_READ_ERROR;

  return toActionResult(await updateVariant({ data: { id, metadata } }));
};

export const deleteVariantsAction = async ({
  data,
}: {
  data: FormData;
}): Promise<AssetActionResult> => {
  const ids = idList(data, "variantIds");
  if (ids.length === 0) {
    return { success: false, message: "No variants selected" };
  }
  return toActionResult(await deleteVariants({ data: { ids } }));
};
