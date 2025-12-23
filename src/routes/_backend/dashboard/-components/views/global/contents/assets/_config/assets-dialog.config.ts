import { FieldConfig } from "@/app/(backend)/dashboard/_components/fields/types";

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

export const createAssetsDialogConfig = (uploadConfig: UploadConfig): DialogConfig => ({
    folder: {
        title: "Create Folder",
        description: "Create a new folder",
        fields: [
            {
                component: "input",
                name: "name",
                label: "Name",
                placeholder: "Folder name",
                required: true,
                autoFocus: true,
            },
            {
                component: "folder-select",
                name: "parent-id",
                label: "Select Folder",
                placeholder: "Select a folder",
            },
            {
                component: "textarea",
                name: "description",
                label: "Description",
                placeholder: "Short description (optional)",
                description: "Optional description to help you identify this folder.",
                rows: 3,
                className: "col-span-2",
            },
            {
                component: "upload",
                name: "assets",
                label: "Assets",
                placeholder: "Select files",
                required: false,
                colSpan: 2,
                minSize: uploadConfig.minFiles,
                maxFiles: uploadConfig.maxFiles,
                maxSize: uploadConfig.maxFileSize,
                accept: uploadConfig.allowedTypes.reduce(
                    (acc: Record<string, string[]>, type: string) => ({ ...acc, [type]: [] }),
                    {}
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
                component: "folder-select",
                name: "parent-id",
                label: "Select Folder",
                placeholder: "Select a folder",
            },
            {
                component: "upload",
                name: "assets",
                label: "Assets",
                placeholder: "Select files",
                required: true,
                colSpan: 2,
                minSize: uploadConfig.minFiles,
                maxFiles: uploadConfig.maxFiles,
                maxSize: uploadConfig.maxFileSize,
                accept: uploadConfig.allowedTypes.reduce(
                    (acc: Record<string, string[]>, type: string) => ({ ...acc, [type]: [] }),
                    {}
                ),
            },
        ],
        gridClassName: "grid-cols-2",
        fieldWrapperClassName: "flex flex-col gap-3",
    },
});

export const getAssetsDialogConfig = (type: DialogType, uploadConfig: UploadConfig) =>
    createAssetsDialogConfig(uploadConfig)[type];
