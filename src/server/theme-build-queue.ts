import { storefrontThemeDependencyDal } from "@/lib/storefront/dal/storefront-theme-dependency.dal";
import { createServerThemeBuildService } from "@/lib/storefront/service/theme-build-service.factory";
import { parseThemeBuildQueueMessage } from "@/lib/storefront/service/theme-build-queue";

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
