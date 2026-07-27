import { FieldConfig } from "@/components/upload/types";

/**
 * The forms the Assets create route can show, and the `?variant` values that
 * select them.
 *
 * One exported union rather than a literal repeated at each call site: the
 * route falls back to `upload` for anything unrecognised, so a typo or a
 * renamed variant would silently open the wrong form instead of failing.
 */
export const ASSET_CREATE_VARIANTS = ["folder", "upload"] as const;

export type AssetCreateVariant = (typeof ASSET_CREATE_VARIANTS)[number];

export const DEFAULT_ASSET_CREATE_VARIANT: AssetCreateVariant = "upload";

/** Narrow an unvalidated `?variant` to a form this route knows. */
export const toAssetCreateVariant = (
  value: string | undefined,
): AssetCreateVariant =>
  ASSET_CREATE_VARIANTS.includes(value as AssetCreateVariant)
    ? (value as AssetCreateVariant)
    : DEFAULT_ASSET_CREATE_VARIANT;

interface UploadConfig {
  maxFileSize: number;
  minFiles: number;
  maxFiles: number;
  allowedTypes: string[];
  allowedExtensions: string[];
}

interface DialogSection {
  title: string;
  description?: string;
  fields: FieldConfig[];
  gridClassName?: string;
}

type DialogConfig = Record<AssetCreateVariant, DialogSection>;

const mimeToExtensionsMap: Record<string, string[]> = {
  "image/jpeg": [".jpg", ".jpeg"],
  "image/png": [".png"],
  "image/gif": [".gif"],
  "image/webp": [".webp"],
  "image/svg+xml": [".svg"],
  "video/mp4": [".mp4"],
  "video/webm": [".webm"],
  "video/ogg": [".ogv", ".ogg"],
  "video/quicktime": [".mov"],
};

const createAcceptMap = (uploadConfig: UploadConfig) => ({
  ...uploadConfig.allowedTypes.reduce(
    (accept, mimeType) => ({
      ...accept,
      [mimeType]: mimeToExtensionsMap[mimeType] || [],
    }),
    {} as Record<string, string[]>,
  ),
  ...(uploadConfig.allowedExtensions.length > 0
    ? { "application/octet-stream": uploadConfig.allowedExtensions }
    : {}),
});

export const createAssetsDialogConfig = (
  uploadConfig: UploadConfig,
): DialogConfig => ({
  folder: {
    title: "Create Folder",
    description: "Create a new folder",
    fields: [
      {
        type: "input",
        name: "name",
        label: "Name",
        placeholder: "Folder name",
        required: true,
        autoFocus: true,
      },
      {
        type: "folder-select",
        name: "parent-id",
        label: "Select Folder",
        placeholder: "Select a folder",
      },
      {
        type: "textarea",
        name: "description",
        label: "Description",
        placeholder: "Short description (optional)",
        description: "Optional description to help you identify this folder.",
        rows: 3,
        className: "col-span-2",
      },
      {
        type: "upload",
        name: "assets",
        label: "Assets",
        placeholder: "Select files",
        required: false,
        colSpan: 2,
        minSize: 1,
        maxFiles: uploadConfig.maxFiles,
        maxSize: uploadConfig.maxFileSize,
        accept: createAcceptMap(uploadConfig),
      },
    ],
    gridClassName: "grid-cols-2",
  },
  upload: {
    title: "Create Asset",
    description: "Upload a new asset to showcase in your storefront.",
    fields: [
      {
        type: "folder-select",
        name: "parent-id",
        label: "Select Folder",
        placeholder: "Select a folder",
      },
      {
        type: "upload",
        name: "assets",
        label: "Assets",
        placeholder: "Select files",
        required: true,
        colSpan: 2,
        minSize: 1,
        maxFiles: uploadConfig.maxFiles,
        maxSize: uploadConfig.maxFileSize,
        accept: createAcceptMap(uploadConfig),
      },
    ],
    gridClassName: "grid-cols-2",
  },
});

export const getAssetCreateConfig = (
  variant: AssetCreateVariant,
  uploadConfig: UploadConfig,
) => createAssetsDialogConfig(uploadConfig)[variant];
