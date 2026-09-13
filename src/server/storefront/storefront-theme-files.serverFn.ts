import { fail, failure, ok, parseInput } from "@/lib/db/server-result";
import { resolveThemeRollbackPlan } from "@/lib/storefront/editor/theme-rollback-plan";
import { buildFileTree } from "@/lib/storefront/dal/storefront-theme-file.dal";
import {
  themeRevisionStore,
  themeSourceStore,
} from "@/lib/storefront/storage/theme-storage.server";
import { createStarterThemeWorkspaceBootstrapPlan } from "@/lib/storefront/starter-theme-files";
import { planNewThemePage } from "@/lib/storefront/compiler/theme-page-scaffold";
import { buildThemeRouteRegistry } from "@/lib/storefront/compiler/theme-route-registry";
import {
  applyStarterThemeWorkspaceInputSchema,
  createThemePageInputSchema,
  createThemeRevisionInputSchema,
  deleteThemeFileInputSchema,
  getThemeFileInputSchema,
  initStarterThemeFilesInputSchema,
  listThemeFilesInputSchema,
  listThemeRevisionsInputSchema,
  previewStarterThemeWorkspaceInputSchema,
  previewThemeRollbackInputSchema,
  rollbackThemeRevisionInputSchema,
  saveThemeFileInputSchema,
  saveThemeFilesBatchInputSchema,
} from "@/lib/validations/storefront-theme-file";
import { createServerFn } from "@tanstack/react-start";
import { commerceAdminMiddleware } from "../middleware/auth.middleware";

export const listStorefrontThemeFiles = createServerFn({ method: "POST" })
  .validator((data: unknown) => parseInput(listThemeFilesInputSchema, data))
  .middleware([commerceAdminMiddleware])
  .handler(async ({ data: input }) => {
    // A rejected precondition is a client error the caller already
    // renders. Letting the ZodError escape the validator instead would
    // reach the browser as an opaque 500 with the reason stripped.
    if (!input.success) return input;
    const data = input.data;

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
  .validator((data: unknown) =>
    parseInput(initStarterThemeFilesInputSchema, data),
  )
  .middleware([commerceAdminMiddleware])
  .handler(async ({ data: input, context }) => {
    // A rejected precondition is a client error the caller already
    // renders. Letting the ZodError escape the validator instead would
    // reach the browser as an opaque 500 with the reason stripped.
    if (!input.success) return input;
    const data = input.data;

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
    parseInput(previewStarterThemeWorkspaceInputSchema, data),
  )
  .middleware([commerceAdminMiddleware])
  .handler(async ({ data: input }) => {
    // A rejected precondition is a client error the caller already
    // renders. Letting the ZodError escape the validator instead would
    // reach the browser as an opaque 500 with the reason stripped.
    if (!input.success) return input;
    const data = input.data;

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
  .validator((data: unknown) => parseInput(getThemeFileInputSchema, data))
  .middleware([commerceAdminMiddleware])
  .handler(async ({ data: input }) => {
    // A rejected precondition is a client error the caller already
    // renders. Letting the ZodError escape the validator instead would
    // reach the browser as an opaque 500 with the reason stripped.
    if (!input.success) return input;
    const data = input.data;

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

/**
 * Creates the source file for a page an author asked for.
 *
 * A Theme's routes are read from its files, so this writes one file and the
 * page exists. The address is planned again here rather than trusted from the
 * editor — the editor plans it too, but only to answer the author while they
 * type.
 *
 * The whole route table is rebuilt with the new file included before anything
 * is written. A page that would leave the Theme unable to describe its own
 * routes is refused while refusing still costs nothing.
 *
 * The generation is the caller's, never one read here. A page added against
 * source the author has not seen would be accepted, and the editor would then
 * treat itself as current while still holding the older copy of every other
 * file — the next save of any of them would overwrite work it never showed.
 */
export const createStorefrontThemePage = createServerFn({ method: "POST" })
  .validator((data: unknown) => parseInput(createThemePageInputSchema, data))
  .middleware([commerceAdminMiddleware])
  .handler(async ({ data: input, context }) => {
    if (!input.success) return input;
    const { storefrontId, themeId, routePath, expectedSourceGeneration } =
      input.data;

    // Read for planning, not for the write: the page has to be checked against
    // the theme as it actually is, while the write is still held to what the
    // author was looking at.
    const files = await themeSourceStore.listFiles(storefrontId, themeId);
    const plan = planNewThemePage({
      requestedPath: routePath,
      existingPaths: files.map((file) => file.path),
    });
    if (!plan.ok) {
      return fail(plan.reason, { error: "INVALID_PAGE_PATH" });
    }

    const registry = buildThemeRouteRegistry([
      ...files.map((file) => ({ path: file.path, content: file.content })),
      { path: plan.sourcePath, content: plan.content },
    ]);
    if (!registry.valid) {
      return fail(
        `Adding ${plan.routePath} would leave this theme's routes invalid.`,
        { error: "INVALID_ROUTE_REGISTRY" },
      );
    }

    let sourceGeneration: number | undefined;
    try {
      const saved = await themeSourceStore.saveFile(
        storefrontId,
        themeId,
        plan.sourcePath,
        plan.content,
        "text/tsx",
        {
          expectMissing: true,
          expectedSourceGeneration,
          createdBy: context.user?.id,
          createRevision: true,
          revisionMessage: `Add page ${plan.routePath}`,
        },
      );
      sourceGeneration = saved.sourceGeneration;
    } catch (error) {
      if (
        error instanceof Error &&
        error.message.includes("CONFLICT_SOURCE_GENERATION_MISMATCH")
      ) {
        const latestGen = await themeSourceStore.getSourceGeneration(
          storefrontId,
          themeId,
        );
        return fail(
          `Remote source changes detected (current generation: ${latestGen ?? "unknown"}): the theme working source was updated by another operation.`,
          { error: "SOURCE_GENERATION_CONFLICT" },
        );
      }
      return failure(
        "createStorefrontThemePage",
        error,
        "PAGE_CREATE_FAILED",
        "Could not add the page.",
      );
    }

    // The generation this write produced, so the editor can adopt exactly the
    // change it caused. Adopting whatever is current instead would silently
    // swallow a change someone else made in between.
    return ok("Page added", {
      sourcePath: plan.sourcePath,
      routePath: plan.routePath,
      sourceGeneration,
    });
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
  .validator((data: unknown) => parseInput(listThemeRevisionsInputSchema, data))
  .middleware([commerceAdminMiddleware])
  .handler(async ({ data: input }) => {
    // A rejected precondition is a client error the caller already renders.
    // Letting the ZodError escape the validator instead would reach the
    // browser as an opaque 500 with the reason stripped.
    if (!input.success) return input;
    const data = input.data;
    try {
      const revisions = await themeRevisionStore.listRevisions(
        data.storefrontId,
        data.themeId,
        { limit: data.limit, offset: data.offset },
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

/**
 * What rolling back to a revision would do, before anything is written.
 *
 * Rollback replaces the whole workspace, so an author has to be able to see
 * which files it restores and which it deletes. Only paths are returned: the
 * question is which files change, and shipping every file's content to answer
 * it would send the whole theme twice.
 */
export const previewStorefrontThemeRollback = createServerFn({ method: "POST" })
  .validator((data: unknown) =>
    parseInput(previewThemeRollbackInputSchema, data),
  )
  .middleware([commerceAdminMiddleware])
  .handler(async ({ data: input }) => {
    // A rejected precondition is a client error the caller already
    // renders. Letting the ZodError escape the validator instead would
    // reach the browser as an opaque 500 with the reason stripped.
    if (!input.success) return input;
    const data = input.data;
    try {
      const [current, sourceGeneration, target] = await Promise.all([
        themeSourceStore.listFiles(data.storefrontId, data.themeId),
        themeSourceStore.getSourceGeneration(data.storefrontId, data.themeId),
        themeRevisionStore.materializeRevisionByNumber(
          data.storefrontId,
          data.themeId,
          data.revisionNumber,
        ),
      ]);
      if (sourceGeneration === null) {
        throw new Error("Theme not found or does not belong to storefront");
      }
      const plan = resolveThemeRollbackPlan({
        current,
        target: target.snapshot,
      });
      return ok("Theme rollback plan ready", {
        // Carried back so the apply can be refused if the workspace moved
        // between seeing this plan and agreeing to it.
        sourceGeneration,
        revisionNumber: data.revisionNumber,
        ...plan,
      });
    } catch (error) {
      return failure(
        "Preview theme rollback error",
        error,
        "ROLLBACK_PREVIEW_FAILED",
        "Failed to prepare the rollback plan",
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
