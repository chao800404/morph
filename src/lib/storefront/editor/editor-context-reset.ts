/**
 * When the editor's context changes, the selection, the pending reveal and the
 * canvas scroll position all belong to the context that was left behind.
 *
 * The decision is extracted here as pure functions because the search
 * parameters it reads have an asymmetry that is easy to erase by accident: a
 * naive "did the context key change" test looks equivalent and is not. The
 * asymmetry is load bearing, so it is stated once, here, with the reason.
 */

/**
 * Whether the template being edited changed since the last render.
 *
 * A template id that only just *appeared* is not a change. The URL may omit
 * `templateId` while the editor resolves one from the template list and writes
 * the resolved id back into the search params, so `undefined -> <id>` is the
 * first resolution of a template the person was already looking at. Resetting
 * there would throw away a selection made before the resolution landed.
 *
 * `""` cannot reach this function: the editor search schema parses `templateId`
 * as a UUID and drops anything else, so "absent" is always `undefined`. That is
 * why the `undefined` guard below is exactly the truthiness test the call site
 * used to spell out inline.
 *
 * `A -> undefined` *does* report a change, which is the asymmetry's sharp edge
 * rather than a considered rule: today the URL parameter is compared, not the
 * resolved template. Resolving to the loaded template instead is a deliberate
 * behaviour change, and it needs its own tests before it happens.
 */
export function didTemplateContextChange(
  previous: string | undefined,
  next: string | undefined,
): boolean {
  return previous !== undefined && previous !== next;
}

/**
 * Whether the route being edited changed since the last render.
 *
 * Deliberately without the `undefined` guard its sibling has. `routePath` is
 * authored rather than resolved, so a value appearing where there was none is a
 * real move to a different page and the canvas should follow it.
 */
export function didRoutePathChange(
  previous: string | undefined,
  next: string | undefined,
): boolean {
  return previous !== next;
}

/**
 * Whether the editor moved to a different logical context.
 *
 * Keeping this as one decision lets the shell perform the reset once when a
 * route and template change arrive in the same render. The two predicates stay
 * separate because their undefined semantics are intentionally different.
 */
export function didEditorContextChange(args: {
  previousTemplateId: string | undefined;
  nextTemplateId: string | undefined;
  previousRoutePath: string | undefined;
  nextRoutePath: string | undefined;
}): boolean {
  return (
    didTemplateContextChange(args.previousTemplateId, args.nextTemplateId) ||
    didRoutePathChange(args.previousRoutePath, args.nextRoutePath)
  );
}

export type EditorContextResetValues = {
  templateId: string | undefined;
  routePath: string | undefined;
};
