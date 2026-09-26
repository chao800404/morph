import { fail, failure, ok, parseInput } from "@/lib/db/server-result";
import {
  resolveThemeRollbackPlan,
  rollbackFileOf,
} from "@/lib/storefront/editor/theme-rollback-plan";
import { buildFileTree } from "@/lib/storefront/dal/storefront-theme-file.dal";
import {
  themeRevisionStore,
  themeSourceStore,
} from "@/lib/storefront/storage/theme-storage.server";
import { storefrontThemeDal } from "@/lib/storefront/dal/storefront-theme.dal";
import {
  applyThemeManifestMigration,
  readThemeManifestMigrationSnapshot,
} from "@/lib/storefront/dal/storefront-theme-manifest-migration.dal";
import { buildThemeContentShadowReport } from "@/lib/storefront/theme-content-capability-shadow";
import {
  buildThemeManifestMigrationPlan,
  LEGACY_THEME_MANIFEST_PATH,
  sourceIndexForLegacyManifestRevision,
  type ThemeManifestMigrationPlan,
} from "@/lib/storefront/theme-manifest-migration";
import { createStarterThemeWorkspaceBootstrapPlan } from "@/lib/storefront/starter-theme-files";
import {
  planNewThemePage,
  planThemePageDeletion,
} from "@/lib/storefront/compiler/theme-page-scaffold";
import { buildThemeRouteRegistry } from "@/lib/storefront/compiler/theme-route-registry";
import {
  applyStarterThemeWorkspaceInputSchema,
  auditThemeContentInputSchema,
  createThemePageInputSchema,
  createThemeRevisionInputSchema,
  deleteThemePageInputSchema,
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
  applyThemeManifestMigrationInputSchema,
  previewThemeManifestMigrationInputSchema,
} from "@/lib/validations/storefront-theme-file";
import { createServerFn } from "@tanstack/react-start";
import {
  isBinaryThemeFile,
  type StorefrontThemeBinaryFileDTO,
  type StorefrontThemeFileDTO,
} from "@/lib/storefront/dto/storefront-theme-file.dto";
import { planConfirmedPublicUrlRewrite } from "@/lib/storefront/service/public-url-rewrite-batch";
import { commerceAdminMiddleware } from "../middleware/auth.middleware";

function rejectLegacyManifestDeletion() {
  return fail(
    "The legacy theme manifest cannot be deleted through the generic file API. Run the server-owned migration after its manifest-removal gate passes.",
    { error: "MANIFEST_REMOVAL_REQUIRES_MIGRATION" },
  );
}

/**
 * Never return source bytes or mutable document bodies in a migration preview.
 * The plan itself is deliberately richer because the apply path needs it, but
 * the browser only needs the gate, diagnostics and affected identities.
 */
function publicThemeManifestMigrationPlan(plan: ThemeManifestMigrationPlan) {
  return {
    status: plan.status,
    storefrontId: plan.storefrontId,
    themeId: plan.themeId,
    sourceGeneration: plan.sourceGeneration,
    manifestFile: plan.manifestFile,
    sourceFilesBefore: plan.sourceFilesBefore.map((file) => ({
      id: file.id,
      path: file.path,
      version: file.version,
    })),
    sourceFilesAfter: plan.sourceFilesAfter.map((file) => ({
      id: file.id,
      path: file.path,
      version: file.version,
    })),
    sourceIndexAfter: plan.sourceIndexAfter
      ? {
          status: plan.sourceIndexAfter.status,
          key: plan.sourceIndexAfter.key,
          diagnostics: plan.sourceIndexAfter.diagnostics,
        }
      : null,
    documentUpdates: plan.documentUpdates.map((update) => ({
      kind: update.kind,
      id: update.id,
    })),
    historicalLegacyRefs: plan.historicalLegacyRefs,
    warnings: plan.warnings,
    rewriteCount: plan.rewriteCount,
    blockers: plan.blockers,
    report: plan.report,
  };
}

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
      const [entries, sourceGeneration, latestPublishedRevision] =
        await Promise.all([
          themeSourceStore.getWorkspaceSnapshot(
            data.storefrontId,
            data.themeId,
          ),
          themeSourceStore.getSourceGeneration(data.storefrontId, data.themeId),
          themeRevisionStore.getLatestPublishedRevision(
            data.storefrontId,
            data.themeId,
          ),
        ]);
      // One read of the whole workspace, split by kind, so the two lists
      // and the tree always describe the same moment. `files` stays source
      // only — everything that edits, previews or saves reads it as text —
      // and binary files come as metadata, never bytes.
      const files: StorefrontThemeFileDTO[] = [];
      const binaryFiles: StorefrontThemeBinaryFileDTO[] = [];
      for (const entry of entries) {
        if (isBinaryThemeFile(entry)) binaryFiles.push(entry);
        else files.push(entry);
      }
      return ok("Theme files listed", {
        files,
        binaryFiles,
        tree: buildFileTree(entries),
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

/**
 * Read-only migration evidence for a Theme that still has morph.theme.json.
 *
 * The server owns both inputs: the workspace files and the stored documents.
 * The browser cannot choose a source path or submit a precomputed report.
 */
export const auditStorefrontThemeContent = createServerFn({ method: "POST" })
  .validator((data: unknown) => parseInput(auditThemeContentInputSchema, data))
  .middleware([commerceAdminMiddleware])
  .handler(async ({ data: input }) => {
    if (!input.success) return input;
    const data = input.data;

    try {
      const [files, sourceGenerationBefore, refs] = await Promise.all([
        themeSourceStore.listFiles(data.storefrontId, data.themeId),
        themeSourceStore.getSourceGeneration(data.storefrontId, data.themeId),
        storefrontThemeDal.listComponentRefsForCapabilityAudit(
          data.storefrontId,
          data.themeId,
        ),
      ]);
      if (!refs || sourceGenerationBefore === null) {
        return fail("Theme not found or does not belong to storefront.", {
          error: "THEME_NOT_FOUND",
        });
      }
      // The current storage contract returns files and generation through
      // separate reads. Refuse to produce a migration report if the workspace
      // moved while the files/documents were being sampled; otherwise the
      // report could describe a generation that never existed as a whole.
      const sourceGenerationAfter = await themeSourceStore.getSourceGeneration(
        data.storefrontId,
        data.themeId,
      );
      if (sourceGenerationAfter === null) {
        return fail("Theme not found or does not belong to storefront.", {
          error: "THEME_NOT_FOUND",
        });
      }
      if (sourceGenerationAfter !== sourceGenerationBefore) {
        return fail(
          "Theme source changed while the audit was running. Run the audit again.",
          { error: "AUDIT_STALE_SOURCE" },
        );
      }
      const report = buildThemeContentShadowReport({
        files,
        sourceGeneration: sourceGenerationAfter,
        draftRefs: refs.draftRefs,
        historicalRefs: refs.historicalRefs,
      });
      return ok("Theme content capability audit ready", report);
    } catch (error) {
      return failure(
        "Audit theme content capability error",
        error,
        "AUDIT_FAILED",
        "Failed to audit Theme content capabilities",
      );
    }
  });

/**
 * Preview the only supported path for removing morph.theme.json. This is a
 * server-owned plan: the client supplies only the Theme identity, never a
 * source path list, a manifest, or a precomputed migration decision.
 */
export const previewThemeManifestMigration = createServerFn({ method: "POST" })
  .validator((data: unknown) =>
    parseInput(previewThemeManifestMigrationInputSchema, data),
  )
  .middleware([commerceAdminMiddleware])
  .handler(async ({ data: input }) => {
    if (!input.success) return input;
    const data = input.data;

    try {
      const snapshot = await readThemeManifestMigrationSnapshot(
        data.storefrontId,
        data.themeId,
      );
      if (!snapshot) {
        return fail("Theme not found or does not belong to storefront.", {
          error: "THEME_NOT_FOUND",
        });
      }
      const plan = buildThemeManifestMigrationPlan(snapshot);
      return ok(
        plan.status === "ready"
          ? "Legacy manifest migration is ready"
          : plan.status === "not-needed"
            ? "Theme does not contain a legacy manifest"
            : "Legacy manifest migration is blocked",
        publicThemeManifestMigrationPlan(plan),
      );
    } catch (error) {
      return failure(
        "Preview legacy theme manifest migration error",
        error,
        "MANIFEST_MIGRATION_PREVIEW_FAILED",
        "Failed to prepare the legacy manifest migration",
      );
    }
  });

/**
 * Re-reads and applies a ready plan in the same request. The browser cannot
 * submit a plan or choose files. OCC guards in the D1 batch refuse the write
 * if the Theme, manifest, or any affected document moved after the read.
 */
export const applyThemeManifestMigrationServerFn = createServerFn({
  method: "POST",
})
  .validator((data: unknown) =>
    parseInput(applyThemeManifestMigrationInputSchema, data),
  )
  .middleware([commerceAdminMiddleware])
  .handler(async ({ data: input, context }) => {
    if (!input.success) return input;
    const data = input.data;

    try {
      const snapshot = await readThemeManifestMigrationSnapshot(
        data.storefrontId,
        data.themeId,
      );
      if (!snapshot) {
        return fail("Theme not found or does not belong to storefront.", {
          error: "THEME_NOT_FOUND",
        });
      }

      const plan = buildThemeManifestMigrationPlan(snapshot);
      if (plan.status === "not-needed") {
        return ok("Theme does not contain a legacy manifest", {
          status: plan.status,
          sourceGeneration: plan.sourceGeneration,
        });
      }
      if (plan.status !== "ready") {
        return fail(
          `Legacy manifest migration is blocked: ${plan.blockers.join(" ")}`,
          { error: "MANIFEST_MIGRATION_BLOCKED" },
        );
      }
      if (!plan.sourceIndexAfter) {
        return fail("The migration did not produce a source index.", {
          error: "MANIFEST_MIGRATION_BLOCKED",
        });
      }
      const readyPlan = plan as ThemeManifestMigrationPlan & {
        status: "ready";
      };

      // Blobs are immutable and content-addressed. They are written before
      // the D1 batch so the newly-created source revision can always restore
      // the exact pre-migration workspace, including morph.theme.json.
      // The plan reads source files only. The revision it writes is the way
      // back to this workspace, so binary files go into it as well; one
      // saved after the plan was read moves the source generation, which
      // the migration's own guard then refuses.
      const binaryFiles = (
        await themeSourceStore.getWorkspaceSnapshot(
          data.storefrontId,
          data.themeId,
        )
      ).filter(isBinaryThemeFile);
      const sourceManifest =
        await themeSourceStore.prepareSourceRevisionManifest([
          ...readyPlan.sourceFilesBefore,
          ...binaryFiles,
        ]);
      const sourceIndexBefore = sourceIndexForLegacyManifestRevision({
        files: readyPlan.sourceFilesBefore,
        sourceManifest,
      });

      const applied = await applyThemeManifestMigration({
        plan: readyPlan,
        sourceManifest,
        sourceIndexBefore,
        createdBy: context.user.id,
      });
      return ok("Legacy theme manifest migrated", {
        status: "applied" as const,
        sourceGeneration: applied.sourceGeneration,
        rewriteCount: readyPlan.rewriteCount,
        deletedPath: LEGACY_THEME_MANIFEST_PATH,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return failure(
        "Apply legacy theme manifest migration error",
        error,
        message.includes("CONFLICT_THEME_MANIFEST_MIGRATION")
          ? "MANIFEST_MIGRATION_CONFLICT"
          : "MANIFEST_MIGRATION_FAILED",
        "Failed to apply the legacy manifest migration",
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
    if (data.path === LEGACY_THEME_MANIFEST_PATH) {
      return rejectLegacyManifestDeletion();
    }
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
    if (
      data.deletions?.some(
        (deletion) => deletion.path === LEGACY_THEME_MANIFEST_PATH,
      )
    ) {
      return rejectLegacyManifestDeletion();
    }
    try {
      let files = data.files;
      if (data.publicUrlRewrite) {
        // Planned from the source as saved, not taken from the editor.
        const confirmed = await planConfirmedPublicUrlRewrite(
          themeSourceStore,
          {
            storefrontId: data.storefrontId,
            themeId: data.themeId,
            expectedSourceGeneration: data.expectedSourceGeneration,
            files: data.files,
            deletions: data.deletions ?? [],
            binaryCopies: data.binaryCopies ?? [],
            publicUrlRewrite: data.publicUrlRewrite,
          },
        );
        if (!confirmed.ok) {
          return fail(confirmed.reason, { error: confirmed.error });
        }
        files = confirmed.files;
      }
      const saved = await themeSourceStore.saveFilesBatch(
        data.storefrontId,
        data.themeId,
        files,
        {
          expectedSourceGeneration: data.expectedSourceGeneration,
          deletions: data.deletions,
          routePathMoves: data.routePathMoves,
          binaryCopies: data.binaryCopies,
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

      if (
        error instanceof Error &&
        error.message.startsWith("THEME_PUBLIC_FILE_REFUSED")
      ) {
        return fail(
          error.message.replace(/^THEME_PUBLIC_FILE_REFUSED:\s*/, ""),
          { error: "THEME_PUBLIC_FILE_REFUSED" },
        );
      }

      if (
        error instanceof Error &&
        (error.message.includes("ROUTE_DOCUMENT_MOVE_UNSUPPORTED") ||
          error.message.includes("ROUTE_DOCUMENT_MOVE_CONFLICT") ||
          error.message.includes("INVALID_ROUTE_DOCUMENT_MOVE"))
      ) {
        return fail(error.message, { error: "ROUTE_DOCUMENT_MOVE_REJECTED" });
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

/**
 * Removes a page and the address it answered on.
 *
 * Deleting a route file deletes a URL, and some route files hold the Theme up
 * rather than serve a page. The whole route table is rebuilt without the file
 * before anything is removed, so a deletion that would leave the Theme unable
 * to describe its own routes — or with no page at all — is refused while
 * refusing still costs nothing.
 *
 * A revision is written first. This is the one editor action that destroys
 * work outright, and rollback is the only way back.
 */
export const deleteStorefrontThemePage = createServerFn({ method: "POST" })
  .validator((data: unknown) => parseInput(deleteThemePageInputSchema, data))
  .middleware([commerceAdminMiddleware])
  .handler(async ({ data: input, context }) => {
    if (!input.success) return input;
    const {
      storefrontId,
      themeId,
      sourcePath,
      expectedFileId,
      expectedVersion,
      expectedSourceGeneration,
    } = input.data;

    const files = await themeSourceStore.listFiles(storefrontId, themeId);
    const plan = planThemePageDeletion({
      sourcePath,
      files: files.map((file) => ({ path: file.path, content: file.content })),
    });
    if (!plan.ok) {
      return fail(plan.reason, { error: "PAGE_NOT_DELETABLE" });
    }

    try {
      await themeRevisionStore.createRevision(storefrontId, themeId, {
        message: `Delete page ${plan.routePath}`,
        createdBy: context.user?.id,
        expectedSourceGeneration,
      });
      const deleted = await themeSourceStore.deleteFile(
        storefrontId,
        themeId,
        plan.sourcePath,
        expectedFileId,
        expectedVersion,
        { expectedSourceGeneration },
      );
      if (!deleted) {
        return fail("Could not delete the page.", { error: "DELETE_FAILED" });
      }
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
        "deleteStorefrontThemePage",
        error,
        "PAGE_DELETE_FAILED",
        "Could not delete the page.",
      );
    }

    const sourceGeneration = await themeSourceStore.getSourceGeneration(
      storefrontId,
      themeId,
    );
    return ok("Page deleted", {
      sourcePath: plan.sourcePath,
      routePath: plan.routePath,
      sourceGeneration: sourceGeneration ?? expectedSourceGeneration + 1,
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
    if (data.path === LEGACY_THEME_MANIFEST_PATH) {
      return rejectLegacyManifestDeletion();
    }
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
        themeSourceStore.getWorkspaceSnapshot(data.storefrontId, data.themeId),
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
      // The whole workspace against the whole revision: source by its text,
      // binary files by digest. Rollback replaces both, so the plan an
      // author agrees to names the images it restores, replaces or deletes.
      const plan = resolveThemeRollbackPlan({
        current: current.map(rollbackFileOf),
        target: target.snapshot.map(rollbackFileOf),
      });
      const routeDocuments = await themeRevisionStore.planRouteDocumentRollback(
        data.storefrontId,
        data.themeId,
        {
          sourceGeneration: target.sourceGeneration ?? null,
          paths: target.snapshot.map((file) => file.path),
        },
      );
      return ok("Theme rollback plan ready", {
        // Carried back so the apply can be refused if the workspace moved
        // between seeing this plan and agreeing to it.
        sourceGeneration,
        revisionNumber: data.revisionNumber,
        ...plan,
        routeDocumentMoves: routeDocuments.ok
          ? routeDocuments.documentMoves.map(
              ({ fromRoutePath, toRoutePath }) => ({
                fromRoutePath,
                toRoutePath,
              }),
            )
          : [],
        routeDocumentConflict: routeDocuments.ok
          ? null
          : routeDocuments.message,
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
      return ok("Theme rolled back to revision", {
        files,
        tree,
        // The rollback is one batch guarded on the expected generation, which
        // it advances by exactly one. The editor accepts this, or its next
        // save would be refused as a remote change it has already applied.
        sourceGeneration: data.expectedSourceGeneration + 1,
      });
    } catch (error) {
      if (
        error instanceof Error &&
        error.message.includes("ROLLBACK_ROUTE_DOCUMENT_CONFLICT")
      ) {
        return fail(error.message, {
          error: "ROLLBACK_ROUTE_DOCUMENT_CONFLICT",
        });
      }
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
