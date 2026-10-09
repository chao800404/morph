import type { PreviewContentWriteResult } from "@/lib/storefront/compiler/preview-content-write";
import {
  PREVIEW_CONTENT_TICKET_HEADER,
  PREVIEW_INSTANCE_HEADER,
} from "@/lib/storefront/compiler/theme-preview-start-runtime";
import type {
  PreviewContentRequest,
  PreviewContentResult,
} from "@/lib/storefront/compiler/preview-write-fence-sandbox";

/**
 * Writing a draft content snapshot into a container's Live Preview, and
 * confirming it through the preview's Worker (docs/astro-theme-plan.md 6.5,
 * 6.6, A6c). The container counterpart of `LocalVitePreviewServer
 * .writeContent`: the write is one fenced request under the lock every
 * workspace write takes; the confirmation is the Worker's own address probe,
 * reached through the same Sandbox proxy the editor's frame uses.
 */

/** What a probe of the preview's Worker said, or null when it said nothing. */
export type PreviewContentProbe = Readonly<{
  ticket: number;
  instance: string;
}> | null;

export type PreviewContentConfirmDeps = Readonly<{
  /** Runs one content request in the container (fenced). */
  run: (request: PreviewContentRequest) => Promise<PreviewContentResult>;
  /** Asks the preview's Worker, through the proxy, what it reads now. */
  probe: () => Promise<PreviewContentProbe>;
  /** Waits between probes; injectable for tests. */
  sleep?: (ms: number) => Promise<void>;
  now?: () => number;
}>;

/** The content file and the instance, as the container holds them. */
export const CONTAINER_CONTENT_PATH = "/workspace/.morph-preview-content.json";

/** Reads a probe's ticket and instance headers. */
export function readPreviewContentProbe(headers: Headers): PreviewContentProbe {
  const ticket = Number(headers.get(PREVIEW_CONTENT_TICKET_HEADER) ?? "");
  const instance = headers.get(PREVIEW_INSTANCE_HEADER) ?? "";
  if (!Number.isSafeInteger(ticket) || ticket < 0) return null;
  return { ticket, instance };
}

/**
 * Waits until the Worker of `instance` names `ticket` or a later one.
 * A report naming another instance — another dev server, one that ran
 * before a restart — confirms nothing.
 */
export async function confirmPreviewContent(
  deps: PreviewContentConfirmDeps,
  expected: Readonly<{ ticket: number; instance: string }>,
  timeoutMs = 10_000,
): Promise<PreviewContentWriteResult> {
  const sleep =
    deps.sleep ?? ((ms: number) => new Promise((resolve) => setTimeout(resolve, ms)));
  const now = deps.now ?? Date.now;
  const deadline = now() + timeoutMs;
  let read = 0;
  for (;;) {
    const probe = await deps.probe().catch(() => null);
    read = probe && probe.instance === expected.instance ? probe.ticket : 0;
    if (read >= expected.ticket) return { applied: true, ticket: read };
    if (now() >= deadline) {
      return { applied: false, reason: "PREVIEW_CONTENT_NOT_CONFIRMED", ticket: read };
    }
    await sleep(100);
  }
}

/**
 * Confirms a ticket already written, without writing: for a sync whose answer
 * was lost. Asks the container which server is running, then that server's
 * Worker what it reads.
 */
export async function confirmContainerPreviewContent(
  deps: PreviewContentConfirmDeps,
  input: Readonly<{ ticket: number; instancePath: string }>,
  timeoutMs?: number,
): Promise<PreviewContentWriteResult> {
  const current = await deps.run({
    op: "read",
    path: CONTAINER_CONTENT_PATH,
    instancePath: input.instancePath,
  });
  if (!current.instance) {
    return { applied: false, reason: "PREVIEW_CONTENT_UNCONFIRMABLE", ticket: current.ticket };
  }
  return confirmPreviewContent(
    deps,
    { ticket: input.ticket, instance: current.instance },
    timeoutMs,
  );
}

/**
 * Writes `content` — refused if the container holds a higher ticket, or this
 * ticket with another hash — then confirms it.
 */
export async function writeContainerPreviewContent(
  deps: PreviewContentConfirmDeps,
  input: Readonly<{ content: string; instancePath: string }>,
  timeoutMs?: number,
): Promise<PreviewContentWriteResult> {
  const result = await deps.run({
    op: "content",
    path: CONTAINER_CONTENT_PATH,
    instancePath: input.instancePath,
    content: input.content,
  });
  switch (result.outcome) {
    case "superseded":
      return { applied: false, reason: "PREVIEW_CONTENT_SUPERSEDED", ticket: result.ticket };
    case "conflict":
      return { applied: false, reason: "PREVIEW_CONTENT_TICKET_CONFLICT", ticket: result.ticket };
    case "no-server":
      // No dev server has been stamped since the container started: nothing
      // that could read the snapshot is running to confirm it.
      return { applied: false, reason: "PREVIEW_CONTENT_UNCONFIRMABLE", ticket: result.ticket };
    case "written":
    case "same":
      return confirmPreviewContent(
        deps,
        { ticket: result.ticket, instance: result.instance! },
        timeoutMs,
      );
    default:
      throw new Error(`PREVIEW_CONTENT_UNEXPECTED: ${result.outcome}`);
  }
}
