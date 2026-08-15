import { fail, failure, ok } from "@/lib/db/server-result";
import {
  buildFileTree,
  storefrontThemeFileDal,
} from "@/lib/storefront/dal/storefront-theme-file.dal";
import {
  deleteThemeFileInputSchema,
  getThemeFileInputSchema,
  listThemeFilesInputSchema,
  saveThemeFileInputSchema,
} from "@/lib/validations/storefront-theme-file";
import { createServerFn } from "@tanstack/react-start";
import { commerceAdminMiddleware } from "../middleware/auth.middleware";

export const listStorefrontThemeFiles = createServerFn({ method: "POST" })
  .validator((data: unknown) => listThemeFilesInputSchema.parse(data))
  .middleware([commerceAdminMiddleware])
  .handler(async ({ data }) => {
    try {
      const files = await storefrontThemeFileDal.listFiles(
        data.storefrontId,
        data.themeId,
      );
      const tree = buildFileTree(files);
      return ok("Theme files listed", { files, tree });
    } catch (error) {
      return failure(
        "List theme files error",
        error,
        "LIST_FAILED",
        "Failed to list theme files",
      );
    }
  });

export const getStorefrontThemeFile = createServerFn({ method: "POST" })
  .validator((data: unknown) => getThemeFileInputSchema.parse(data))
  .middleware([commerceAdminMiddleware])
  .handler(async ({ data }) => {
    try {
      const file = await storefrontThemeFileDal.getFileByPath(
        data.storefrontId,
        data.themeId,
        data.path,
      );
      return file
        ? ok("Theme file loaded", file)
        : fail("File not found", { error: "NOT_FOUND" });
    } catch (error) {
      return failure(
        "Get theme file error",
        error,
        "GET_FAILED",
        "Failed to load theme file",
      );
    }
  });

export const saveStorefrontThemeFile = createServerFn({ method: "POST" })
  .validator((data: unknown) => saveThemeFileInputSchema.parse(data))
  .middleware([commerceAdminMiddleware])
  .handler(async ({ data }) => {
    try {
      const saved = await storefrontThemeFileDal.saveFile(
        data.storefrontId,
        data.themeId,
        data.path,
        data.content,
        data.mimeType,
      );
      return ok("Theme file saved", saved);
    } catch (error) {
      return failure(
        "Save theme file error",
        error,
        "SAVE_FAILED",
        "Failed to save theme file",
      );
    }
  });

export const deleteStorefrontThemeFile = createServerFn({ method: "POST" })
  .validator((data: unknown) => deleteThemeFileInputSchema.parse(data))
  .middleware([commerceAdminMiddleware])
  .handler(async ({ data }) => {
    try {
      const success = await storefrontThemeFileDal.deleteFile(
        data.storefrontId,
        data.themeId,
        data.path,
      );
      return success
        ? ok("Theme file deleted", { path: data.path })
        : fail("Failed to delete file", { error: "DELETE_FAILED" });
    } catch (error) {
      return failure(
        "Delete theme file error",
        error,
        "DELETE_FAILED",
        "Failed to delete theme file",
      );
    }
  });
