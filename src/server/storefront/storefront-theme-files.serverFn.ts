import { fail, failure, ok } from "@/lib/db/server-result";
import {
  buildFileTree,
  storefrontThemeFileDal,
} from "@/lib/storefront/dal/storefront-theme-file.dal";
import {
  deleteThemeFileInputSchema,
  getThemeFileInputSchema,
  initStarterThemeFilesInputSchema,
  listThemeFilesInputSchema,
  listThemeRevisionsInputSchema,
  rollbackThemeRevisionInputSchema,
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

export const initStorefrontStarterTheme = createServerFn({ method: "POST" })
  .validator((data: unknown) => initStarterThemeFilesInputSchema.parse(data))
  .middleware([commerceAdminMiddleware])
  .handler(async ({ data, context }) => {
    try {
      const files = await storefrontThemeFileDal.initStarterTheme(
        data.storefrontId,
        data.themeId,
        context.user?.id,
      );
      const tree = buildFileTree(files);
      return ok("Starter theme initialized", { files, tree });
    } catch (error) {
      return failure(
        "Init starter theme error",
        error,
        "INIT_FAILED",
        "Failed to initialize starter theme",
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
  .handler(async ({ data, context }) => {
    try {
      const saved = await storefrontThemeFileDal.saveFile(
        data.storefrontId,
        data.themeId,
        data.path,
        data.content,
        data.mimeType,
        {
          createRevision: data.createRevision,
          revisionMessage: data.revisionMessage,
          createdBy: context.user?.id,
        },
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

export const listStorefrontThemeRevisions = createServerFn({ method: "POST" })
  .validator((data: unknown) => listThemeRevisionsInputSchema.parse(data))
  .middleware([commerceAdminMiddleware])
  .handler(async ({ data }) => {
    try {
      const revisions = await storefrontThemeFileDal.listRevisions(
        data.storefrontId,
        data.themeId,
      );
      return ok("Theme revisions listed", revisions);
    } catch (error) {
      return failure(
        "List theme revisions error",
        error,
        "LIST_FAILED",
        "Failed to list theme revisions",
      );
    }
  });

export const rollbackStorefrontThemeRevision = createServerFn({ method: "POST" })
  .validator((data: unknown) => rollbackThemeRevisionInputSchema.parse(data))
  .middleware([commerceAdminMiddleware])
  .handler(async ({ data, context }) => {
    try {
      const files = await storefrontThemeFileDal.rollbackToRevision(
        data.storefrontId,
        data.themeId,
        data.revisionNumber,
        context.user?.id,
      );
      const tree = buildFileTree(files);
      return ok("Theme rolled back to revision", { files, tree });
    } catch (error) {
      return failure(
        "Rollback theme revision error",
        error,
        "ROLLBACK_FAILED",
        "Failed to rollback theme revision",
      );
    }
  });
