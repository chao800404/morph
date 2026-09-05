import { fail, failure, ok, parseInput } from "@/lib/db/server-result";
import { parseRejectedContentField } from "@/lib/storefront/theme-content-capabilities";
import { storefrontThemeDal } from "@/lib/storefront/dal/storefront-theme.dal";
import {
  createReleasePreviewQueueMessage,
  type ThemeBuildQueue,
} from "@/lib/storefront/service/theme-build-queue";
import { storefrontDal } from "@/lib/storefront/dal/storefront.dal";
import {
  publishStorefrontThemeTemplateInputSchema,
  reorderStorefrontThemeSectionsInputSchema,
  storefrontThemeEditorInputSchema,
  updateStorefrontThemeSectionPropsInputSchema,
} from "@/lib/validations/storefront-theme";
import { createServerFn } from "@tanstack/react-start";
import { env as cloudflareEnv } from "cloudflare:workers";
import { storefrontThemeBuildDal } from "@/lib/storefront/dal/storefront-theme-build.dal";
import { storefrontReleaseDal } from "@/lib/storefront/dal/storefront-release.dal";
import {
  deployReleaseArtifact,
  deployWithRecovery,
} from "@/lib/storefront/service/storefront-release-reconciler";
import { withDeploymentLease } from "@/lib/storefront/service/deployment-lease";
import { canSkipThemeWorkerDeployment } from "@/lib/storefront/service/theme-worker-deployment-state";
import { createServerThemeWorkerDeployer } from "@/lib/storefront/service/theme-worker-deployer.factory";
import { getRequest } from "@tanstack/react-start/server";
import { commerceAdminMiddleware } from "../middleware/auth.middleware";

/** Inspector tab the browser last used, so SSR renders the same one. */
function parseEditorPanelTab(cookieHeader: string | null | undefined) {
  if (!cookieHeader) return undefined;
  for (const segment of cookieHeader.split(";")) {
    const [rawKey, rawVal] = segment.trim().split("=");
    if (!rawKey || !rawVal) continue;
    if (decodeURIComponent(rawKey) !== "morph:editor-assistant-panel-tab") {
      continue;
    }
    const value = decodeURIComponent(rawVal);
    // Validated here rather than trusted: the value reaches a render.
    if (["chat", "content", "styles"].includes(value)) return value;
  }
  return undefined;
}

function parseEditorPanelWidths(cookieHeader: string | null | undefined) {
  const defaults = { left: 260, right: 380 };
  if (!cookieHeader) return defaults;
  let left = defaults.left;
  let right = defaults.right;
  for (const segment of cookieHeader.split(";")) {
    const [rawKey, rawVal] = segment.trim().split("=");
    if (!rawKey || !rawVal) continue;
    const key = decodeURIComponent(rawKey);
    const val = Number(decodeURIComponent(rawVal));
    if (
      key === "morph:editor-left-panel-width" &&
      Number.isFinite(val) &&
      val >= 220 &&
      val <= 460
    ) {
      left = val;
    }
    if (
      key === "morph:editor-right-panel-width" &&
      Number.isFinite(val) &&
      val >= 280 &&
      val <= 640
    ) {
      right = val;
    }
  }
  return { left, right };
}

export const getStorefrontThemeEditor = createServerFn({ method: "POST" })
  .validator((data: unknown) =>
    parseInput(storefrontThemeEditorInputSchema, data),
  )
  .middleware([commerceAdminMiddleware])
  .handler(async ({ data: input, context: authContext }) => {
    // A rejected precondition is a client error the caller already
    // renders. Letting the ZodError escape the validator instead would
    // reach the browser as an opaque 500 with the reason stripped.
    if (!input.success) return input;
    const data = input.data;

    try {
      const request = getRequest();
      const cookieHeader = request?.headers?.get("cookie");
      const panelWidths = parseEditorPanelWidths(cookieHeader);
      const panelTab = parseEditorPanelTab(cookieHeader);
      const editorOrigin = request
        ? new URL(request.url).origin
        : process.env.PUBLIC_URL || "http://localhost:3000";
      await storefrontDal.ensureStoredStarterPreview({
        storefrontId: data.storefrontId,
        themeId: data.themeId,
        createdBy: authContext.user.id,
      });
      const context = await storefrontThemeDal.findEditorContext(
        data.storefrontId,
        data.themeId,
      );
      return context
        ? ok("Storefront theme editor fetched", {
            ...context,
            panelWidths,
            panelTab,
            previewChannel: {
              editorOrigin,
              sessionId: crypto.randomUUID(),
            },
          })
        : fail("Storefront theme not found", { error: "NOT_FOUND" });
    } catch (error) {
      return failure(
        "Get storefront theme editor error",
        error,
        "GET_FAILED",
        "Failed to fetch storefront theme editor",
      );
    }
  });

export const reorderStorefrontThemeSections = createServerFn({ method: "POST" })
  .validator((data: unknown) =>
    parseInput(reorderStorefrontThemeSectionsInputSchema, data),
  )
  .middleware([commerceAdminMiddleware])
  .handler(async ({ data: input, context }) => {
    // A rejected precondition is a client error the caller already
    // renders. Letting the ZodError escape the validator instead would
    // reach the browser as an opaque 500 with the reason stripped.
    if (!input.success) return input;
    const data = input.data;
    try {
      const result = await storefrontThemeDal.reorderSections({
        ...data,
        createdBy: context.user.id,
      });
      return result
        ? ok("Theme sections reordered", result)
        : fail("Theme template or section order not found", {
            error: "NOT_FOUND",
          });
    } catch (error) {
      return failure(
        "Reorder storefront theme sections error",
        error,
        "UPDATE_FAILED",
        "Failed to reorder theme sections",
      );
    }
  });

export const updateStorefrontThemeSectionProps = createServerFn({
  method: "POST",
})
  .validator((data: unknown) =>
    parseInput(updateStorefrontThemeSectionPropsInputSchema, data),
  )
  .middleware([commerceAdminMiddleware])
  .handler(async ({ data: input, context }) => {
    // A rejected precondition is a client error the caller already
    // renders. Letting the ZodError escape the validator instead would
    // reach the browser as an opaque 500 with the reason stripped.
    if (!input.success) return input;
    const data = input.data;
    try {
      const result = await storefrontThemeDal.updateSectionProps({
        ...data,
        createdBy: context.user.id,
      });
      return result
        ? ok("Theme section props updated", result)
        : fail("Theme template or section not found", {
            error: "NOT_FOUND",
          });
    } catch (error) {
      const message = error instanceof Error ? error.message : "";
      const rejected = parseRejectedContentField(message);
      if (rejected) {
        // The thrown error names the field — down to `items.0.title` for a row
        // — and why it was refused. Dropping either left the editor saying only
        // that something did not match, with no way to tell which of a dozen
        // controls to look at, let alone what to change about it.
        const detail = rejected.reason
          ? ` (${rejected.reason.replace(/-/g, " ")})`
          : "";
        return fail(
          `"${rejected.fieldKey}" does not match the Theme field declaration${detail}.`,
          {
            error: "INVALID_CONTENT_FIELD",
            errors: {
              [rejected.fieldKey]: [
                rejected.reason ?? "Does not match the declared field.",
              ],
            },
          },
        );
      }
      return failure(
        "Update storefront theme section props error",
        error,
        "UPDATE_FAILED",
        "Failed to update section props",
      );
    }
  });

/**
 * Asks for a picture of a release that has just been published.
 *
 * Fire-and-forget on purpose: a capture reaches an external rendering service,
 * and the release is already durable and deployed by the time this runs. A
 * queue that is unreachable must not turn a publish that succeeded into one
 * that reports failure, so the send is swallowed rather than awaited into the
 * result.
 */
async function queueReleasePreviewCapture(
  storefrontId: string,
  releaseId: string,
): Promise<void> {
  try {
    const queue = (
      cloudflareEnv as unknown as { THEME_BUILD_QUEUE?: ThemeBuildQueue }
    ).THEME_BUILD_QUEUE;
    if (!queue) return;
    await queue.send(
      createReleasePreviewQueueMessage({ storefrontId, releaseId }),
    );
  } catch (error) {
    console.error("Failed to queue release preview capture:", error);
  }
}

export const publishStorefrontThemeTemplate = createServerFn({ method: "POST" })
  .validator((data: unknown) =>
    parseInput(publishStorefrontThemeTemplateInputSchema, data),
  )
  .middleware([commerceAdminMiddleware])
  .handler(async ({ data: input, context }) => {
    // A rejected precondition is a client error the caller already
    // renders. Letting the ZodError escape the validator instead would
    // reach the browser as an opaque 500 with the reason stripped.
    if (!input.success) return input;
    const data = input.data;
    try {
      // The lease covers the whole sequence, not just the deploy.
      //
      // `publishTemplate` moves `active_release_id` before anything is sent to
      // the Worker. Taking the lease afterwards meant a publish that lost the
      // race had already changed the pointer and then reported BUSY, leaving
      // the storefront naming release B while the Worker still ran A — the
      // exact drift the lease exists to prevent, reached through the door it
      // was not guarding.
      const held = await withDeploymentLease({
        storefrontId: data.storefrontId,
        owner: `publish:${crypto.randomUUID()}`,
        ports: {
          acquire: (leaseArgs) =>
            storefrontReleaseDal.acquireDeploymentLease(leaseArgs),
          release: (leaseArgs) =>
            storefrontReleaseDal.releaseDeploymentLease(leaseArgs),
        },
        operation: async () => {
          const result = await storefrontThemeDal.publishTemplate({
            ...data,
            createdBy: context.user.id,
          });
          if (!result) {
            return fail("Theme template or draft revision not found", {
              error: "NOT_FOUND",
            });
          }

          if (result.unchanged) {
            return ok("Theme is already published", result);
          }

          // D1 activation is written atomically by publishTemplate, but the Theme
          // Worker is separate state. Deploy the release that was just activated,
          // and report a failure explicitly: silently returning success would leave
          // the storefront serving the previous build while the dashboard reports
          // the new release as live.
          //
          // Concurrent publishes cannot race here — `expectedReleaseGeneration`
          // already rejects the second one before it reaches this point.
          if (result.releaseId) {
            // A publish that only changed content reuses the build that is already
            // live, so redeploying uploads bytes the Worker already serves — a
            // container start and a wrangler run for a text edit. Skipped only when
            // a previous deployment of exactly this build is recorded as having
            // succeeded; every uncertain case still deploys.
            if (
              canSkipThemeWorkerDeployment({
                deployedThemeBuildId: result.previousDeployedThemeBuildId,
                releaseThemeBuildId: result.themeBuildId,
              })
            ) {
              await storefrontReleaseDal.recordDeployedThemeBuild({
                storefrontId: data.storefrontId,
                releaseId: result.releaseId,
                themeBuildId: result.themeBuildId,
              });
              await queueReleasePreviewCapture(
                data.storefrontId,
                result.releaseId,
              );
              return ok("Theme published", result);
            }

            // Narrowed once, here: `releaseId` is nullable, and a deploy without
            // one has nothing to send. Reading it inside the lease callback below
            // loses the narrowing, and defaulting it would deploy the wrong thing.
            const releaseId = result.releaseId;
            if (!releaseId) {
              return fail(
                "Theme published, but no release was created to deploy.",
                { error: "RELEASE_DEPLOYMENT_FAILED", ...result },
              );
            }

            const deployed = await deployWithRecovery({
              restore: () =>
                storefrontThemeDal.restoreFailedPublish({
                  storefrontId: data.storefrontId,
                  themeId: data.themeId,
                  templateId: data.templateId,
                  releaseId,
                  releaseGeneration: result.releaseGeneration,
                  previousActiveReleaseId: result.previousActiveReleaseId,
                  previousPublishedRevisionId:
                    result.previousPublishedRevisionId,
                  previousPublishedSourceRevisionId:
                    result.previousPublishedSourceRevisionId,
                }),
              deploy: () =>
                deployReleaseArtifact({
                  releaseId,
                  deployer: createServerThemeWorkerDeployer(),
                  r2Bucket: (
                    cloudflareEnv as unknown as { R2_BUCKET?: unknown }
                  ).R2_BUCKET as never,
                  ports: {
                    getRelease: async (releaseId) => {
                      const release = await storefrontReleaseDal.getById(
                        data.storefrontId,
                        releaseId,
                      );
                      return release
                        ? {
                            id: release.id,
                            storefrontId: data.storefrontId,
                            themeId: release.themeId,
                            themeBuildId: release.themeBuildId,
                          }
                        : null;
                    },
                    getBuild: (buildId) =>
                      storefrontThemeBuildDal.getBuildById(buildId),
                  },
                }),
            });
            if (!deployed.success) {
              return fail(
                "deploymentDrift" in deployed && deployed.deploymentDrift
                  ? "Deployment failed and the previous activation could not be restored. The storefront requires reconciliation."
                  : "Deployment failed. The previous activation was restored; reload and retry publishing.",
                {
                  error:
                    "deploymentDrift" in deployed && deployed.deploymentDrift
                      ? "RELEASE_DEPLOYMENT_DRIFT"
                      : "RELEASE_DEPLOYMENT_FAILED",
                },
              );
            }

            // Recorded only now, so a failed deploy above leaves no trace that
            // would let the next publish skip a deployment that never landed.
            await storefrontReleaseDal.recordDeployedThemeBuild({
              storefrontId: data.storefrontId,
              releaseId: result.releaseId,
              themeBuildId: result.themeBuildId,
            });
            await queueReleasePreviewCapture(
              data.storefrontId,
              result.releaseId,
            );
          }

          return ok("Theme published", result);
        },
      });

      if (!held.acquired) {
        // Nothing was written: the pointer only moves inside the lease.
        return fail(
          "A deployment still holds this storefront's lock. Wait for it to finish; if it was interrupted, an operator must verify it stopped before clearing the lock.",
          { error: "RELEASE_DEPLOYMENT_BUSY" },
        );
      }
      return held.value;
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Failed to publish theme";
      if (message.includes("RELEASE_GENERATION_CONFLICT")) {
        return fail(
          "Another release was published. Refresh the latest release before publishing again.",
          { error: "RELEASE_GENERATION_CONFLICT" },
        );
      }
      if (message.includes("TEMPLATE_DRAFT_CONFLICT")) {
        return fail("Template draft was modified concurrently.", {
          error: "TEMPLATE_DRAFT_CONFLICT",
        });
      }
      if (
        message.includes("PUBLISH_BUILD_NOT_FOUND") ||
        message.includes("PUBLISH_BUILD_NOT_READY") ||
        message.includes("PUBLISH_BUILD_MISMATCH")
      ) {
        return fail(
          "Publish requires a succeeded Build Preview bound to the selected source revision.",
          { error: "PUBLISH_BUILD_NOT_READY" },
        );
      }
      return failure(
        "Publish storefront theme template error",
        error,
        "UPDATE_FAILED",
        "Failed to publish theme",
      );
    }
  });
