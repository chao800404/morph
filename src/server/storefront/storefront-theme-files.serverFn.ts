import { fail, failure, ok } from "@/lib/db/server-result";
import { buildFileTree } from "@/lib/storefront/dal/storefront-theme-file.dal";
import {
  themeRevisionStore,
  themeSourceStore,
} from "@/lib/storefront/storage/theme-storage.server";
import {
  createThemeRevisionInputSchema,
  deleteThemeFileInputSchema,
  getThemeFileInputSchema,
  initStarterThemeFilesInputSchema,
  listThemeFilesInputSchema,
  listThemeRevisionsInputSchema,
  rollbackThemeRevisionInputSchema,
  saveThemeFileInputSchema,
  saveThemeFilesBatchInputSchema,
} from "@/lib/validations/storefront-theme-file";
import { createServerFn } from "@tanstack/react-start";
import { commerceAdminMiddleware } from "../middleware/auth.middleware";

export const listStorefrontThemeFiles = createServerFn({ method: "POST" })
  .validator((data: unknown) => listThemeFilesInputSchema.parse(data))
  .middleware([commerceAdminMiddleware])
  .handler(async ({ data }) => {
    try {
      const [treeFiles, sourceGeneration, latestPublishedRevision] =
        await Promise.all([
          themeSourceStore.listFiles(data.storefrontId, data.themeId),
          themeSourceStore.getSourceGeneration(data.storefrontId, data.themeId),
          themeRevisionStore.getLatestPublishedRevision(
            data.storefrontId,
            data.themeId,
          ),
        ]);
      const tree = buildFileTree(treeFiles);
      return ok("Theme files listed", {
        files: treeFiles,
        tree,
        sourceGeneration: sourceGeneration ?? 1,
        latestPublishedRevision,
      });
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
      const files = await themeSourceStore.initStarterTheme(
        data.storefrontId,
        data.themeId,
        context.user?.id,
      );
      const sourceGeneration = await themeSourceStore.getSourceGeneration(
        data.storefrontId,
        data.themeId,
      );
      const tree = buildFileTree(files);
      return ok("Starter theme initialized", {
        files,
        tree,
        sourceGeneration: sourceGeneration ?? 1,
      });
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
      const file = await themeSourceStore.getFileByPath(
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
      const saved = await themeSourceStore.saveFile(
        data.storefrontId,
        data.themeId,
        data.path,
        data.content,
        data.mimeType,
        {
          expectedFileId: data.expectedFileId,
          expectedVersion: data.expectedVersion,
          expectMissing: data.expectMissing,
          expectedSourceGeneration: data.expectedSourceGeneration,
          createRevision: data.createRevision,
          revisionMessage: data.revisionMessage,
          createdBy: context.user?.id,
        },
      );
      return ok("Theme file saved", saved);
    } catch (error) {
      if (
        error instanceof Error &&
        error.message.includes("CONFLICT_SOURCE_GENERATION_MISMATCH")
      ) {
        const latestGen = await themeSourceStore.getSourceGeneration(
          data.storefrontId,
          data.themeId,
        );
        return fail(
          `Remote source changes detected (current generation: ${latestGen ?? "unknown"}): the theme working source was updated by another operation.`,
          { error: "SOURCE_GENERATION_CONFLICT" },
        );
      }

      if (
        error instanceof Error &&
        error.message.includes("CONFLICT_VERSION_MISMATCH")
      ) {
        return fail(
          "Version conflict detected: file was modified by another operation.",
          { error: "FILE_VERSION_CONFLICT" },
        );
      }

      return failure(
        "Save theme file error",
        error,
        "SAVE_FAILED",
        "Failed to save theme file",
      );
    }
  });

export const saveStorefrontThemeFilesBatch = createServerFn({ method: "POST" })
  .validator((data: unknown) => saveThemeFilesBatchInputSchema.parse(data))
  .middleware([commerceAdminMiddleware])
  .handler(async ({ data, context }) => {
    try {
      const saved = await themeSourceStore.saveFilesBatch(
        data.storefrontId,
        data.themeId,
        data.files,
        {
          expectedSourceGeneration: data.expectedSourceGeneration,
          deletions: data.deletions,
          createRevision: data.createRevision,
          revisionMessage: data.revisionMessage,
          createdBy: context.user?.id,
        },
      );
      return ok("Theme files batch saved", {
        files: saved,
        sourceGeneration: saved.sourceGeneration ?? 1,
      });
    } catch (error) {
      if (
        error instanceof Error &&
        error.message.includes("CONFLICT_SOURCE_GENERATION_MISMATCH")
      ) {
        const latestGen = await themeSourceStore.getSourceGeneration(
          data.storefrontId,
          data.themeId,
        );
        return fail(
          `Remote source changes detected in batch (current generation: ${latestGen ?? "unknown"}): the theme working source was updated by another operation.`,
          { error: "SOURCE_GENERATION_CONFLICT" },
        );
      }

      if (
        error instanceof Error &&
        error.message.includes("CONFLICT_VERSION_MISMATCH")
      ) {
        return fail(
          "Version conflict detected in batch: one or more files were modified concurrently.",
          { error: "FILE_VERSION_CONFLICT" },
        );
      }

      return failure(
        "Save theme files batch error",
        error,
        "SAVE_FAILED",
        "Failed to save theme files batch",
      );
    }
  });

export const deleteStorefrontThemeFile = createServerFn({ method: "POST" })
  .validator((data: unknown) => deleteThemeFileInputSchema.parse(data))
  .middleware([commerceAdminMiddleware])
  .handler(async ({ data }) => {
    try {
      const success = await themeSourceStore.deleteFile(
        data.storefrontId,
        data.themeId,
        data.path,
        data.expectedFileId,
        data.expectedVersion,
        {
          expectedSourceGeneration: data.expectedSourceGeneration,
        },
      );
      if (!success)
        return fail("Failed to delete file", { error: "DELETE_FAILED" });
      const sourceGeneration = await themeSourceStore.getSourceGeneration(
        data.storefrontId,
        data.themeId,
      );
      return ok("Theme file deleted", {
        path: data.path,
        sourceGeneration: sourceGeneration ?? data.expectedSourceGeneration + 1,
      });
    } catch (error) {
      if (
        error instanceof Error &&
        error.message.includes("CONFLICT_SOURCE_GENERATION_MISMATCH")
      ) {
        const latestGen = await themeSourceStore.getSourceGeneration(
          data.storefrontId,
          data.themeId,
        );
        return fail(
          `Remote source changes detected before delete (current generation: ${latestGen ?? "unknown"}): the theme working source was updated by another operation.`,
          { error: "SOURCE_GENERATION_CONFLICT" },
        );
      }

      if (
        error instanceof Error &&
        error.message.includes("CONFLICT_VERSION_MISMATCH")
      ) {
        return fail(
          "Version conflict detected: file was modified or replaced before delete.",
          { error: "FILE_VERSION_CONFLICT" },
        );
      }
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
      const revisions = await themeRevisionStore.listRevisions(
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

export const rollbackStorefrontThemeRevision = createServerFn({
  method: "POST",
})
  .validator((data: unknown) => rollbackThemeRevisionInputSchema.parse(data))
  .middleware([commerceAdminMiddleware])
  .handler(async ({ data, context }) => {
    try {
      const files = await themeRevisionStore.rollbackToRevision(
        data.storefrontId,
        data.themeId,
        data.revisionNumber,
        {
          expectedSourceGeneration: data.expectedSourceGeneration,
          createdBy: context.user?.id,
        },
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

export const createStorefrontThemeRevision = createServerFn({ method: "POST" })
  .validator((data: unknown) => createThemeRevisionInputSchema.parse(data))
  .middleware([commerceAdminMiddleware])
  .handler(async ({ data, context }) => {
    try {
      const revision = await themeRevisionStore.createRevision(
        data.storefrontId,
        data.themeId,
        {
          message: data.message ?? "Published Theme Source",
          source: data.source ?? "manual",
          expectedSourceGeneration: data.expectedSourceGeneration,
          createdBy: context.user?.id,
        },
      );
      return ok("Theme revision created", revision);
    } catch (error) {
      return failure(
        "Create theme revision error",
        error,
        "CREATE_FAILED",
        "Failed to create theme revision",
      );
    }
  });
