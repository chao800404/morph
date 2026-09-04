import { fail, failure, ok, parseInput } from "@/lib/db/server-result";
import { buildFileTree } from "@/lib/storefront/dal/storefront-theme-file.dal";
import {
  themeRevisionStore,
  themeSourceStore,
} from "@/lib/storefront/storage/theme-storage.server";
import { createStarterThemeWorkspaceBootstrapPlan } from "@/lib/storefront/starter-theme-files";
import {
  applyStarterThemeWorkspaceInputSchema,
  createThemeRevisionInputSchema,
  deleteThemeFileInputSchema,
  getThemeFileInputSchema,
  initStarterThemeFilesInputSchema,
  listThemeFilesInputSchema,
  listThemeRevisionsInputSchema,
  previewStarterThemeWorkspaceInputSchema,
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

/**
 * Preview the additive Starter Theme bootstrap before mutating the workspace.
 * The plan is always calculated from server files; the browser cannot choose
 * which template files or package versions are written.
 */
export const previewStarterThemeWorkspace = createServerFn({ method: "POST" })
  .validator((data: unknown) =>
    previewStarterThemeWorkspaceInputSchema.parse(data),
  )
  .middleware([commerceAdminMiddleware])
  .handler(async ({ data }) => {
    try {
      const [files, sourceGeneration] = await Promise.all([
        themeSourceStore.listFiles(data.storefrontId, data.themeId),
        themeSourceStore.getSourceGeneration(data.storefrontId, data.themeId),
      ]);
      if (sourceGeneration === null) {
        throw new Error("Theme not found or does not belong to storefront");
      }

      const plan = createStarterThemeWorkspaceBootstrapPlan(files);
      return ok("Starter theme bootstrap plan ready", {
        sourceGeneration,
        files: plan.files.map((file) => ({
          path: file.path,
          operation: file.expectMissing ? "create" : "update",
        })),
        deletions: plan.deletions.map((file) => ({ path: file.path })),
      });
    } catch (error) {
      return failure(
        "Preview starter theme bootstrap error",
        error,
        "STARTER_BOOTSTRAP_PREVIEW_FAILED",
        "Failed to prepare the starter theme files",
      );
    }
  });

/**
 * Apply the server-calculated Starter Theme bootstrap as one OCC-protected
 * batch. Existing authored files are preserved and all writes/deletions land
 * in the same source revision transaction.
 */
export const applyStarterThemeWorkspace = createServerFn({ method: "POST" })
  .validator((data: unknown) =>
    parseInput(applyStarterThemeWorkspaceInputSchema, data),
  )
  .middleware([commerceAdminMiddleware])
  .handler(async ({ data: input, context }) => {
    // A rejected precondition is a client error the caller already
    // renders. Letting the ZodError escape the validator instead would
    // reach the browser as an opaque 500 with the reason stripped.
    if (!input.success) return input;
    const data = input.data;
    try {
      const files = await themeSourceStore.listFiles(
        data.storefrontId,
        data.themeId,
      );
      const sourceGeneration = await themeSourceStore.getSourceGeneration(
        data.storefrontId,
        data.themeId,
      );
      if (sourceGeneration === null) {
        throw new Error("Theme not found or does not belong to storefront");
      }
      const plan = createStarterThemeWorkspaceBootstrapPlan(files);
      if (plan.files.length === 0 && plan.deletions.length === 0) {
        return ok("Starter theme is already up to date", {
          files,
          sourceGeneration,
          changed: false,
        });
      }

      const saved = await themeSourceStore.saveFilesBatch(
        data.storefrontId,
        data.themeId,
        plan.files,
        {
          expectedSourceGeneration: data.expectedSourceGeneration,
          deletions: plan.deletions,
          createRevision: true,
          revisionMessage: "Bootstrap TanStack Start theme workspace",
          createdBy: context.user?.id,
        },
      );
      const nextFiles = await themeSourceStore.listFiles(
        data.storefrontId,
        data.themeId,
      );
      return ok("Starter theme workspace bootstrapped", {
        files: nextFiles,
        sourceGeneration: saved.sourceGeneration ?? sourceGeneration + 1,
        changed: true,
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
          `Remote source changes detected before starter setup (current generation: ${latestGen ?? "unknown"}). Refresh the workspace and try again.`,
          { error: "SOURCE_GENERATION_CONFLICT" },
        );
      }
      if (
        error instanceof Error &&
        error.message.includes("CONFLICT_VERSION_MISMATCH")
      ) {
        return fail(
          "Version conflict detected: the starter workspace changed concurrently.",
          { error: "FILE_VERSION_CONFLICT" },
        );
      }
      return failure(
        "Apply starter theme bootstrap error",
        error,
        "STARTER_BOOTSTRAP_FAILED",
        "Failed to apply the starter theme files",
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
  .validator((data: unknown) => parseInput(saveThemeFileInputSchema, data))
  .middleware([commerceAdminMiddleware])
  .handler(async ({ data: input, context }) => {
    // A rejected precondition is a client error the editor already
    // renders. Letting the ZodError escape the validator instead would
    // reach the browser as an opaque 500 with the reason stripped.
    if (!input.success) return input;
    const data = input.data;
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
  .validator((data: unknown) =>
    parseInput(saveThemeFilesBatchInputSchema, data),
  )
  .middleware([commerceAdminMiddleware])
  .handler(async ({ data: input, context }) => {
    // A rejected precondition is a client error the editor already
    // renders. Letting the ZodError escape the validator instead would
    // reach the browser as an opaque 500 with the reason stripped.
    if (!input.success) return input;
    const data = input.data;
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
  .validator((data: unknown) => parseInput(deleteThemeFileInputSchema, data))
  .middleware([commerceAdminMiddleware])
  .handler(async ({ data: input }) => {
    // A rejected precondition is a client error the caller already
    // renders. Letting the ZodError escape the validator instead would
    // reach the browser as an opaque 500 with the reason stripped.
    if (!input.success) return input;
    const data = input.data;
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
  .validator((data: unknown) =>
    parseInput(rollbackThemeRevisionInputSchema, data),
  )
  .middleware([commerceAdminMiddleware])
  .handler(async ({ data: input, context }) => {
    // A rejected precondition is a client error the caller already
    // renders. Letting the ZodError escape the validator instead would
    // reach the browser as an opaque 500 with the reason stripped.
    if (!input.success) return input;
    const data = input.data;
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
  .validator((data: unknown) =>
    parseInput(createThemeRevisionInputSchema, data),
  )
  .middleware([commerceAdminMiddleware])
  .handler(async ({ data: input, context }) => {
    // A rejected precondition is a client error the caller already
    // renders. Letting the ZodError escape the validator instead would
    // reach the browser as an opaque 500 with the reason stripped.
    if (!input.success) return input;
    const data = input.data;
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
