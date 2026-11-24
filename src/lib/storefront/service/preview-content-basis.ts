import type { PreviewContentConfirmDeps } from "./preview-content-confirm";

/**
 * What Core tells the editor about a content snapshot it wrote into a Live
 * Preview, for the Astro basis acknowledgement (option B,
 * handoff/2026-11-24/astro-presentation-ack-options.md). The editor compares
 * the frame's `morph-content` stamp with these; Core never reads the stamp,
 * and nothing here takes part in any write check.
 */

/**
 * Each template's draft generation in a snapshot, from the versions it was
 * read at (`contentVersions`, `storefrontPreviewContentTicketDal
 * .readDraftVersions`: `{ templates: [{ id, generation, revision }], pages }`).
 * Anything that is not a template id with a positive generation is left out;
 * text that cannot be read names nothing.
 */
export function previewContentDraftGenerations(
  contentVersions: string | undefined,
): Record<string, number> {
  if (!contentVersions) return {};
  let parsed: unknown;
  try {
    parsed = JSON.parse(contentVersions);
  } catch {
    return {};
  }
  const templates =
    parsed && typeof parsed === "object"
      ? (parsed as { templates?: unknown }).templates
      : undefined;
  if (!Array.isArray(templates)) return {};
  const generations: Record<string, number> = {};
  for (const template of templates) {
    if (!template || typeof template !== "object") continue;
    const { id, generation } = template as { id?: unknown; generation?: unknown };
    if (
      typeof id === "string" &&
      id.length > 0 &&
      typeof generation === "number" &&
      Number.isSafeInteger(generation) &&
      generation > 0
    ) {
      generations[id] = generation;
    }
  }
  return generations;
}

/**
 * The same confirmation deps, recording the instance the last probe named.
 * `confirmPreviewContent` answers `applied` only right after a probe of the
 * instance it waits for, so after an applied answer this is the instance
 * whose Worker confirmed the ticket. Read it only then.
 */
export function withConfirmingInstance(deps: PreviewContentConfirmDeps): {
  deps: PreviewContentConfirmDeps;
  instance: () => string | null;
} {
  let last: string | null = null;
  return {
    deps: {
      ...deps,
      probe: async () => {
        const probe = await deps.probe();
        last = probe && probe.instance ? probe.instance : null;
        return probe;
      },
    },
    instance: () => last,
  };
}
