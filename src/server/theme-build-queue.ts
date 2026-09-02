import { storefrontThemeDependencyDal } from "@/lib/storefront/dal/storefront-theme-dependency.dal";
import { createServerThemeBuildService } from "@/lib/storefront/service/theme-build-service.factory";
import { parseThemeBuildQueueMessage } from "@/lib/storefront/service/theme-build-queue";
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
      payload = parseThemeBuildQueueMessage(message.body);
    } catch {
      // Invalid messages are permanently malformed and must not poison the
      // queue. Acknowledge them after validation fails.
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
