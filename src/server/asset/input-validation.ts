import { updateItemsSchema } from "@/lib/validations/asset";
import { z } from "zod";

export type AssetInputError = {
  formError?: string;
  errors?: Record<string, string[]>;
};

type UpdateItemsInput = z.infer<typeof updateItemsSchema> & AssetInputError;
type MoveItemsInput = {
  itemIds: string[];
  destinationFolder: string | null;
} & AssetInputError;
type DeleteItemsInput = {
  folderIds: string[];
  assetIds: string[];
} & AssetInputError;

export const isFormDataLike = (value: unknown): value is FormData =>
  typeof value === "object" &&
  value !== null &&
  typeof (value as FormData).get === "function" &&
  typeof (value as FormData).getAll === "function";

const jsonUuidArray = z.string().transform((value, context) => {
  try {
    const ids = z
      .array(z.uuid("Invalid item ID"))
      .max(100, "A maximum of 100 items may be changed at once")
      .parse(JSON.parse(value));
    if (new Set(ids).size !== ids.length) {
      context.addIssue({
        code: "custom",
        message: "Duplicate item IDs are not allowed",
      });
      return z.NEVER;
    }
    return ids;
  } catch {
    context.addIssue({ code: "custom", message: "Invalid item list" });
    return z.NEVER;
  }
});

const optionalJsonUuidArray = z.preprocess(
  (value) =>
    value === null || value === undefined || value === "" ? "[]" : value,
  jsonUuidArray,
);

const toInputError = (error: z.ZodError): AssetInputError => {
  const fieldErrors = error.flatten().fieldErrors as Record<
    string,
    string[] | undefined
  >;
  const errors = Object.fromEntries(
    Object.entries(fieldErrors).filter((entry): entry is [string, string[]] =>
      Boolean(entry[1]?.length),
    ),
  );
  const formError =
    Object.values(fieldErrors).find((messages) => messages?.length)?.[0] ??
    error.issues[0]?.message ??
    "Invalid form data";
  return { formError, errors };
};

export const parseUpdateItemsInput = (data: unknown): UpdateItemsInput => {
  if (!isFormDataLike(data)) {
    return { itemsData: [], formError: "Invalid form data" };
  }
  const result = updateItemsSchema.safeParse({
    itemsData: data.get("itemsData"),
  });
  return result.success
    ? result.data
    : { itemsData: [], ...toInputError(result.error) };
};

const moveItemsSchema = z.object({
  itemIds: jsonUuidArray.refine(
    (ids) => ids.length > 0,
    "Select at least one item",
  ),
  destinationFolder: z.preprocess(
    (value) =>
      value === null || value === undefined || value === "" || value === "root"
        ? null
        : value,
    z.uuid("Invalid destination folder ID").nullable(),
  ),
});

export const parseMoveItemsInput = (data: unknown): MoveItemsInput => {
  if (!isFormDataLike(data)) {
    return {
      itemIds: [],
      destinationFolder: null,
      formError: "Invalid form data",
    };
  }
  const result = moveItemsSchema.safeParse({
    itemIds: data.get("itemIds"),
    destinationFolder: data.get("Destination Folder"),
  });
  return result.success
    ? result.data
    : { itemIds: [], destinationFolder: null, ...toInputError(result.error) };
};

const deleteItemsSchema = z
  .object({
    folderIds: optionalJsonUuidArray,
    assetIds: optionalJsonUuidArray,
  })
  .refine((value) => value.folderIds.length + value.assetIds.length > 0, {
    message: "Select at least one item",
  });

export const parseDeleteItemsInput = (data: unknown): DeleteItemsInput => {
  if (!isFormDataLike(data)) {
    return { folderIds: [], assetIds: [], formError: "Invalid form data" };
  }
  const result = deleteItemsSchema.safeParse({
    folderIds: data.get("folderIds"),
    assetIds: data.get("assetIds"),
  });
  return result.success
    ? result.data
    : { folderIds: [], assetIds: [], ...toInputError(result.error) };
};
