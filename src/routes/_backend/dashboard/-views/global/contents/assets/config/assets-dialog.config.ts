import { FieldConfig } from "@/components/upload/types";

type DialogType = "folder" | "assets";

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
  fieldWrapperClassName?: string;
}

type DialogConfig = Record<DialogType, DialogSection>;

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
        minSize: uploadConfig.minFiles,
        maxFiles: uploadConfig.maxFiles,
        maxSize: uploadConfig.maxFileSize,
        accept: uploadConfig.allowedTypes.reduce(
          (acc: Record<string, string[]>, type: string) => ({
            ...acc,
            [type]: [],
          }),
          {},
        ),
      },
    ],
    gridClassName: "grid-cols-2",
    fieldWrapperClassName: "flex flex-col gap-3",
  },
  assets: {
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
        minSize: uploadConfig.minFiles,
        maxFiles: uploadConfig.maxFiles,
        maxSize: uploadConfig.maxFileSize,
        accept: uploadConfig.allowedTypes.reduce(
          (acc: Record<string, string[]>, type: string) => ({
            ...acc,
            [type]: [],
          }),
          {},
        ),
      },
    ],
    gridClassName: "grid-cols-2",
    fieldWrapperClassName: "flex flex-col gap-3",
  },
});

export const getAssetsDialogConfig = (
  type: DialogType,
  uploadConfig: UploadConfig,
) => createAssetsDialogConfig(uploadConfig)[type];
