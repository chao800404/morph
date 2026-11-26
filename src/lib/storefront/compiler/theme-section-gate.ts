/**
 * M3 Hide, approach E: the platform's section gate.
 *
 * Morph's compiled guard (`theme-hide-guard.ts`) mounts every section it can
 * hide through this module:
 *
 *   <MorphSectionGate slot="x" render={() => (<El …author props…/>)} />
 *
 * - The hidden list is read once, at the gate's own top level, from the
 *   root route's snapshot: the `morphContent` the Starter root's
 *   `beforeLoad` loads through the fail-closed Starter 32 content module and
 *   hands to `MorphContentProvider`. The same object, so the gate and
 *   `content()` cannot disagree, on the server, while hydrating and after a
 *   client navigation or a Live Preview edit (both re-run `beforeLoad`). The
 *   Theme's editable `isSectionHidden` export is not consulted.
 * - A hidden section renders nothing, and `render` is never called: its
 *   props, and any hook their expressions call (`content()`), are never
 *   evaluated, so no default and no value reaches the page.
 * - A visible section is rendered by a body component the gate mounts while
 *   it is visible. A hook called while building its props therefore runs on
 *   every render of that body, never conditionally inside the route's own
 *   render.
 * - A route context with no usable hidden list throws
 *   `MorphSectionVisibilityError`. Nothing is known about which sections the
 *   author hid, so the section is not shown; the router renders its error
 *   state instead.
 *
 * `MorphPageSectionGate` is the same gate for a section read from a loader's
 * page object, which carries its own `_hidden` list.
 *
 * The file is the platform's, written into every Start workspace beside the
 * SDK copy and resolved from `@morph/sdk/section-gate`
 * (`theme-morph-sdk.ts`); a Theme does not carry it. It is covered by the
 * guard version in the build identity (`THEME_HIDE_GUARD_VERSION`): change
 * that version whenever this source changes.
 */

/** The bare name Morph's compiled guard imports the gate from. */
export const THEME_SECTION_GATE_MODULE = "@morph/sdk/section-gate";

/** Where the gate lives in a workspace, relative to its root. */
export const THEME_SECTION_GATE_PATH = ".morph/section-gate.ts";

const SECTION_GATE_SOURCE = `import { createElement, type ReactNode } from "react";
import { useRouteContext } from "@tanstack/react-router";

/**
 * Thrown while rendering a section whose visibility cannot be read. The page
 * is not rendered with the section shown instead.
 */
export class MorphSectionVisibilityError extends Error {
  readonly code = "section_visibility_unavailable";
  constructor(detail: string) {
    super("Morph cannot tell whether this section is hidden: " + detail);
    this.name = "MorphSectionVisibilityError";
  }
}

function hiddenList(value: unknown, source: string): readonly string[] {
  if (!Array.isArray(value) || !value.every((slot) => typeof slot === "string")) {
    throw new MorphSectionVisibilityError(source + " carries no usable hidden list.");
  }
  return value;
}

function MorphSectionBody(props: { render: () => ReactNode }): ReactNode {
  return props.render();
}

/** A section read through content(): visibility from the root route's snapshot. */
export function MorphSectionGate(props: { slot: string; render: () => ReactNode }): ReactNode {
  const context = useRouteContext({ from: "__root__" } as never) as unknown;
  const morphContent =
    context && typeof context === "object"
      ? (context as { morphContent?: unknown }).morphContent
      : undefined;
  const hidden = hiddenList(
    morphContent && typeof morphContent === "object"
      ? (morphContent as { hiddenSlots?: unknown }).hiddenSlots
      : undefined,
    "The page content",
  );
  if (hidden.includes(props.slot)) return null;
  return createElement(MorphSectionBody, { render: props.render });
}

/** A section read from a loader's page object: visibility from that page. */
export function MorphPageSectionGate(props: {
  slot: string;
  hidden: unknown;
  render: () => ReactNode;
}): ReactNode {
  if (hiddenList(props.hidden, "The page").includes(props.slot)) return null;
  return createElement(MorphSectionBody, { render: props.render });
}
`;

/** The gate's source, as the workspace carries it. */
export function themeSectionGateSource(): string {
  return SECTION_GATE_SOURCE;
}

/** The gate file a Start workspace carries. */
export function themeSectionGateFile(): { path: string; content: string } {
  return { path: THEME_SECTION_GATE_PATH, content: SECTION_GATE_SOURCE };
}
