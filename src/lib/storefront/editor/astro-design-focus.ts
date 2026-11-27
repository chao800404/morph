import type { AstroRouteBindingsView } from "../source-language/astro-route-bindings";
import { ASTRO_BASIS_UNCONFIRMED_MESSAGE } from "./astro-basis-presentation";
import {
  astroDesignHint,
  resolveAstroDesignSelection,
  type AstroDesignHint,
  type AstroDesignSelection,
} from "./astro-design-selection";
import { PREVIEW_DOCUMENT_NAVIGATION_TIMEOUT_MS } from "./preview-document-navigation";

/**
 * The Astro section the author selected on the canvas, and what Design says
 * about it now (lead decisions Q2/Q3, handoff/2026-11-24/astro-basis-hints.md).
 *
 * - Q2: an unconfirmed basis (the token was not issued, its `applied` was
 *   held, or the frame answered `not-applied`) is said where the section is:
 *   at the top of the Inspector and as a badge on its row
 *   (`astroDesignNoticeOf`), never in a toast.
 * - Q3: a new document never keeps the old frame's selection. The editor
 *   keeps only the identity Core confirmed, waits for Core's binding view
 *   read for the new document, and matches it exactly
 *   (`rederiveAstroDesignSelection`). No match clears the selection, with
 *   the hint.
 *
 * Display state only. Nothing here grants a write: Core verifies identity,
 * component digest and both CASes on every write. Start never reaches this:
 * a focus is only ever set from the Astro click path.
 */

export type ConfirmedAstroDesignSelection = Extract<
  AstroDesignSelection,
  { status: "confirmed" }
>;

export type AstroDesignFocus = Readonly<{
  /** The confirmed instance; null once it could not be confirmed again. */
  selection: ConfirmedAstroDesignSelection | null;
  /** What the author is told; null when there is nothing to say. */
  hint: AstroDesignHint | null;
  /** A new document is on screen and Core's view for it is not read yet. */
  rederiving: boolean;
}>;

export type AstroDesignFocusEvent =
  /** A click Core confirmed (`resolveAstroDesignSelection`). */
  | Readonly<{ kind: "selected"; selection: ConfirmedAstroDesignSelection }>
  /** Any other click, or another page: nothing is selected. */
  | Readonly<{ kind: "deselected" }>
  /** The section's basis cannot be presented on this document. */
  | Readonly<{ kind: "basis-unconfirmed"; sectionId: string; reason: string }>
  /** The frame acknowledged the section's basis and the editor took it. */
  | Readonly<{ kind: "basis-acknowledged"; sectionId: string }>
  /** A new document's ready: the selection waits for Core's view. */
  | Readonly<{ kind: "document-replaced" }>
  /** Core's view for the new document, matched against `identity`. */
  | Readonly<{
      kind: "rederived";
      identity: string;
      result: AstroDesignSelection;
    }>;

/** Class A of plan v2 §6.2 for an unconfirmed basis: reload the preview. */
export function astroBasisUnconfirmedHint(reason: string): AstroDesignHint {
  return {
    class: "temporarily-unconfirmable",
    reason: `basis-${reason}`,
    action: "reload-preview",
    message: ASTRO_BASIS_UNCONFIRMED_MESSAGE,
  };
}

/** Said on the section while Core's view for the new document is read. */
export const ASTRO_SELECTION_RECHECKING_MESSAGE =
  "The preview reloaded. Checking this section against the saved source again.";

/**
 * How long "Checking…" is said before the re-derive gives up and clears the
 * selection, with the reload hint (fail closed, as for no view): a view read
 * or confirm that never settles, a frame that never says which page it
 * shows, or an answer dropped for a frame that never became ready. The same
 * bound as a document page switch (`PREVIEW_DOCUMENT_NAVIGATION_TIMEOUT_MS`,
 * below the heartbeat's 15 s), since it waits on the same new document.
 * Giving up early only clears a display; Core still verifies every write.
 */
export const ASTRO_SELECTION_RECHECK_TIMEOUT_MS =
  PREVIEW_DOCUMENT_NAVIGATION_TIMEOUT_MS;

/**
 * The kept selection matched again in Core's view for the new document, by
 * the same exact rule as a click: rule, route sha256 and range of the
 * identity, and Core's component digest as it was confirmed. Nothing is
 * matched by section id, name or ordinal.
 */
export function rederiveAstroDesignSelection(args: {
  selection: ConfirmedAstroDesignSelection;
  view: AstroRouteBindingsView | null;
  workspaceSourceGeneration: number | null;
  routePath: string;
}): AstroDesignSelection {
  return resolveAstroDesignSelection({
    request: {
      status: "pending-core",
      marker: args.selection.identity,
      // Not read by the match; the click's location opened Code already.
      sourceLocation: "",
      sourceDigest: args.selection.componentDigest,
    },
    view: args.view,
    workspaceSourceGeneration: args.workspaceSourceGeneration,
    routePath: args.routePath,
  });
}

export function stepAstroDesignFocus(
  focus: AstroDesignFocus | null,
  event: AstroDesignFocusEvent,
): AstroDesignFocus | null {
  switch (event.kind) {
    case "selected":
      return { selection: event.selection, hint: null, rederiving: false };
    case "deselected":
      return null;
    case "basis-unconfirmed":
      // Only about the section selected now, on the document it was asked on.
      if (
        !focus?.selection ||
        focus.rederiving ||
        focus.selection.sectionId !== event.sectionId
      ) {
        return focus;
      }
      return { ...focus, hint: astroBasisUnconfirmedHint(event.reason) };
    case "basis-acknowledged":
      if (
        !focus?.selection ||
        focus.selection.sectionId !== event.sectionId ||
        focus.hint === null
      ) {
        return focus;
      }
      return { ...focus, hint: null };
    case "document-replaced":
      // A hint was about the old document; a cleared selection is not
      // carried into the new one.
      if (!focus?.selection) return null;
      return { selection: focus.selection, hint: null, rederiving: true };
    case "rederived": {
      if (
        !focus?.selection ||
        !focus.rederiving ||
        focus.selection.identity !== event.identity
      ) {
        return focus;
      }
      const { result } = event;
      if (result.status === "confirmed") {
        return { selection: result, hint: null, rederiving: false };
      }
      return {
        selection: null,
        hint:
          result.status === "refused"
            ? result.hint
            : // No view could be read for the new document: fail closed.
              astroDesignHint("temporarily-unconfirmable", "binding-view-unread"),
        rederiving: false,
      };
    }
  }
}

/** What the Inspector top and the section's row show; null for nothing. */
export type AstroDesignNotice = Readonly<{
  /** The section it is about; null when the selection was cleared. */
  sectionId: string | null;
  tone: "checking" | "unconfirmed";
  message: string;
  /** The short label of the section row's badge. */
  badge: string;
  action: AstroDesignHint["action"] | null;
}>;

const BADGE_FOR_ACTION: Record<AstroDesignHint["action"], string> = {
  "reload-preview": "Reload preview",
  retry: "Try again",
  "open-code": "Use Code",
};

export function astroDesignNoticeOf(
  focus: AstroDesignFocus | null,
): AstroDesignNotice | null {
  if (!focus) return null;
  if (focus.selection && focus.rederiving) {
    return {
      sectionId: focus.selection.sectionId,
      tone: "checking",
      message: ASTRO_SELECTION_RECHECKING_MESSAGE,
      badge: "Checking…",
      action: null,
    };
  }
  if (!focus.hint) return null;
  return {
    sectionId: focus.selection?.sectionId ?? null,
    tone: "unconfirmed",
    message: focus.hint.message,
    badge: BADGE_FOR_ACTION[focus.hint.action],
    action: focus.hint.action,
  };
}
