import type { AssetActionResult } from "@/lib/asset/action-result";
import { createCollection, deleteCollections, updateCollection } from "@/server/product/collections.serverFn";
import {
  createProductCategory,
  deleteProductCategories,
  updateProductCategory,
} from "@/server/product/categories.serverFn";
import { createProductOption, deleteProductOptions, updateProductOption } from "@/server/product/options.serverFn";
import { deleteProducts, updateProduct } from "@/server/product/update-product.serverFn";

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

  return toActionResult(
    await updateProduct({
      data: {
        id,
        title: text(data, "title"),
        handle: text(data, "handle"),
        subtitle: text(data, "subtitle") ?? null,
        description: text(data, "description") ?? null,
      },
    }),
  );
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

  return toActionResult(
    await createProductOption({ data: { title, values } }),
  );
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
