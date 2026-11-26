/**
 * Which consumer a Cloudflare Queues batch reaches, by the queue's name.
 *
 * Queue names are unique per Cloudflare account, so a second Morph deployment
 * in the same account (staging) has to rename both of its queues, and the
 * Worker has to be told the names. Each defaults to the name in
 * `wrangler.jsonc`, so a deployment that sets neither routes exactly as it
 * did when the names were literals.
 *
 * A batch from any other queue is refused by throwing, which leaves its
 * messages unacknowledged for Cloudflare to retry. It used to go to the theme
 * build consumer, which acknowledges a message it cannot parse: a renamed
 * inventory queue would have lost every export and import silently.
 */

export const INVENTORY_EXPORT_QUEUE_NAME_VAR =
  "MORPH_INVENTORY_EXPORT_QUEUE_NAME";
export const THEME_BUILD_QUEUE_NAME_VAR = "MORPH_THEME_BUILD_QUEUE_NAME";

export const DEFAULT_INVENTORY_EXPORT_QUEUE_NAME = "morph-inventory-exports";
export const DEFAULT_THEME_BUILD_QUEUE_NAME = "morph-theme-builds";

/** What Cloudflare accepts as a queue name. */
const QUEUE_NAME = /^[a-z0-9][a-z0-9-]{0,62}$/;

export type QueueConsumer = "inventory-export" | "theme-build";

export type QueueConsumerSelection =
  { consumer: QueueConsumer } | { refused: string };

type QueueEnv = Readonly<Record<string, unknown>> | undefined;

function configuredName(
  env: QueueEnv,
  variable: string,
  fallback: string,
): { ok: true; name: string } | { ok: false; message: string } {
  const raw = env?.[variable];
  if (raw === undefined) return { ok: true, name: fallback };
  if (typeof raw !== "string" || !QUEUE_NAME.test(raw)) {
    return {
      ok: false,
      message: `${variable} is not a valid queue name; no queue batch is consumed until it is fixed or removed.`,
    };
  }
  return { ok: true, name: raw };
}

export function selectQueueConsumer(
  queueName: unknown,
  env: QueueEnv,
): QueueConsumerSelection {
  const inventory = configuredName(
    env,
    INVENTORY_EXPORT_QUEUE_NAME_VAR,
    DEFAULT_INVENTORY_EXPORT_QUEUE_NAME,
  );
  if (!inventory.ok) return { refused: inventory.message };
  const theme = configuredName(
    env,
    THEME_BUILD_QUEUE_NAME_VAR,
    DEFAULT_THEME_BUILD_QUEUE_NAME,
  );
  if (!theme.ok) return { refused: theme.message };
  if (inventory.name === theme.name) {
    return {
      refused: `${INVENTORY_EXPORT_QUEUE_NAME_VAR} and ${THEME_BUILD_QUEUE_NAME_VAR} name the same queue "${theme.name}"; no queue batch is consumed until they differ.`,
    };
  }

  if (queueName === inventory.name) return { consumer: "inventory-export" };
  if (queueName === theme.name) return { consumer: "theme-build" };
  return {
    refused: `Queue "${String(queueName)}" has no consumer here: expected "${inventory.name}" (${INVENTORY_EXPORT_QUEUE_NAME_VAR}) or "${theme.name}" (${THEME_BUILD_QUEUE_NAME_VAR}). Its messages are left for retry.`,
  };
}

/**
 * Routes one batch. Throws when it is refused: Cloudflare then retries the
 * batch's messages rather than counting them as handled.
 */
export async function dispatchQueueBatch<Batch extends { queue?: string }>(
  batch: Batch,
  env: QueueEnv,
  consumers: Readonly<{
    inventoryExport: (batch: Batch) => Promise<void>;
    themeBuild: (batch: Batch) => Promise<void>;
  }>,
): Promise<void> {
  const selected = selectQueueConsumer(batch.queue, env);
  if ("refused" in selected) throw new Error(selected.refused);
  if (selected.consumer === "inventory-export") {
    await consumers.inventoryExport(batch);
    return;
  }
  await consumers.themeBuild(batch);
}
