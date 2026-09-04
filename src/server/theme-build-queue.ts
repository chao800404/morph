import { storefrontThemeDependencyDal } from "@/lib/storefront/dal/storefront-theme-dependency.dal";
import { createServerThemeBuildService } from "@/lib/storefront/service/theme-build-service.factory";
import { parseStorefrontQueueMessage } from "@/lib/storefront/service/theme-build-queue";
import { runReleasePreviewCapture } from "./release-preview-capture";
import { isTerminalThemeBuildStatus } from "@/lib/storefront/theme-build-status";

type QueueMessage = {
  body: unknown;
  ack?: () => void;
};

type ThemeBuildQueueBatch = {
  messages: QueueMessage[];
};

/** Process one immutable build message at a time. Throwing asks Cloudflare
 * Queues to retry the message instead of acknowledging a transient failure. */
export async function processThemeBuildQueue(
  batch: ThemeBuildQueueBatch,
): Promise<void> {
  const service = createServerThemeBuildService();
  for (const message of batch.messages) {
    let payload;
    try {
      payload = parseStorefrontQueueMessage(message.body);
    } catch {
      // Invalid messages are permanently malformed and must not poison the
      // queue. Acknowledge them after validation fails.
      message.ack?.();
      continue;
    }

    if (payload.type === "release-preview") {
      // A capture is decoration for a release that already exists. Its result
      // is acknowledged either way: retrying a rate-limited screenshot would
      // spend the daily browser budget re-failing, and the page falls back to
      // a placeholder on its own.
      try {
        await runReleasePreviewCapture(payload);
      } catch (error) {
        console.error("Release preview capture threw:", error);
      }
      message.ack?.();
      continue;
    }

    // A build cancelled while still queued is already terminal. Running it
    // would spend a Sandbox on work whose result may never be written, since
    // the runner's completion write loses to the cancellation.
    const existing = await service.getThemeBuild(payload);
    if (existing && isTerminalThemeBuildStatus(existing.status)) {
      message.ack?.();
      continue;
    }

    const build = await service.executeQueuedBuild(payload);
    if (build.status === "succeeded") {
      await storefrontThemeDependencyDal.markBuildResult(build.id, "ready");
    } else if (build.status === "failed") {
      await storefrontThemeDependencyDal.markBuildResult(
        build.id,
        "failed",
        build.errorMessage ?? undefined,
      );
    }
  }
}
