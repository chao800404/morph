/**
 * The draft generation to send with a write, for the template being written.
 *
 * The editor writes to more than one template from a single canvas: a page's
 * sections belong to that page, while the shell's belong to the shell, which
 * has no URL of its own. The OCC guard compares this number against the row it
 * is writing, so answering with whichever template happens to be open rejects
 * every shell edit as a concurrent modification — the row was never at that
 * generation.
 *
 * The in-session map wins over the stored value because it holds the result of
 * this session's own writes, which the fetched context has not caught up with.
 */
export function resolveTemplateDraftGeneration(args: {
  templateId: string;
  /** Generations returned by this session's writes, keyed by template. */
  observed: ReadonlyMap<string, number>;
  /** Templates as last fetched. */
  templates: readonly { id: string; draftGeneration?: number }[];
}): number {
  const observed = args.observed.get(args.templateId);
  if (typeof observed === "number") return observed;
  const stored = args.templates.find(
    (template) => template.id === args.templateId,
  )?.draftGeneration;
  return typeof stored === "number" ? stored : 1;
}

/**
 * Brings this session's observed generations up to date after a publish.
 *
 * Publishing seals the page's draft and moves its draft generation on, and
 * also the shell's when the shell had unpublished edits. The observed value
 * from this session's last write would otherwise outrank the refreshed
 * context in `resolveTemplateDraftGeneration`, so the first edit after a
 * publish was sent at the old generation and refused as out of date.
 *
 * The page takes the generation the publish returned. Every other template
 * the publish may have sealed is forgotten here, so the refreshed context
 * answers for it.
 */
export function observeGenerationsAfterPublish(
  observed: Map<string, number>,
  publish: {
    templateId: string;
    /** The page's draft generation as the publish left it. */
    draftGeneration: number | undefined;
    /** Other templates the publish may have sealed (the shell). */
    alsoSealed: readonly string[];
  },
): void {
  if (typeof publish.draftGeneration === "number") {
    observed.set(publish.templateId, publish.draftGeneration);
  } else {
    observed.delete(publish.templateId);
  }
  for (const templateId of publish.alsoSealed) {
    if (templateId !== publish.templateId) observed.delete(templateId);
  }
}
