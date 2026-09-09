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
