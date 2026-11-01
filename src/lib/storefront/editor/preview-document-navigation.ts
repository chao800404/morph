import { previewStructureMatchesRoute } from "./preview-structure-route";

/**
 * The editor's side of a page switch in a preview that navigates as
 * documents (Astro; D3, theme-preview-navigation.ts).
 *
 * Sending set-route there loads another document in the frame. Nothing from
 * the frame is the editor's page until that document has come up and
 * answered the route request naming the page asked for; the shell's
 * `frameShowsEditorPage` holds edits and selection until then. This only
 * says what to show meanwhile, and when to stop waiting.
 *
 * A Theme whose preview navigates by router never reaches this.
 */

/**
 * How long a page switch may take before the editor says it did not open.
 * Below the heartbeat's 15 s, so a page that never comes up is named as the
 * page that did not open before the preview as a whole is reconnected.
 */
export const PREVIEW_DOCUMENT_NAVIGATION_TIMEOUT_MS = 10_000;

export type PreviewDocumentNavigationState =
  | Readonly<{ status: "idle" }>
  | Readonly<{
      status: "opening";
      key: string;
      routePath: string;
      /** The page the frame last confirmed for this key, if any. */
      from: string | null;
      startedAt: number;
    }>
  | Readonly<{ status: "open"; key: string; routePath: string }>
  /**
   * The frame answered from another page than the one asked for: the author
   * followed a link inside it, or a redirect ended there. The editor follows
   * it to a page it lists (the shell's frame follow); on any other page the
   * canvas stays off. Settled, so nothing times out.
   */
  | Readonly<{
      status: "elsewhere";
      key: string;
      routePath: string;
      /** Where the frame is. */
      framePath: string;
    }>
  | Readonly<{
      status: "failed";
      key: string;
      routePath: string;
      /**
       * `timeout`: no answer in time. `not-navigated`: the frame answered
       * that it has no page to go to (a bridge older than document
       * navigation). `pattern`: a dynamic route, which has no address.
       */
      reason: "timeout" | "not-navigated" | "pattern";
    }>;

export type PreviewDocumentNavigationEvent =
  | Readonly<{ type: "route-sent"; key: string; routePath: string; at: number }>
  | Readonly<{ type: "route-answered"; key: string; routePath: string | null }>
  | Readonly<{
      type: "timed-out";
      key: string;
      routePath: string;
      startedAt: number;
    }>;

export const initialPreviewDocumentNavigationState: PreviewDocumentNavigationState =
  { status: "idle" };

/** A dynamic route pattern (`[slug]`, `[...rest]`): a file name, no address. */
export function isRoutePatternPath(routePath: string): boolean {
  return /\[[^\]]*\]/.test(routePath);
}

const samePage = (left: string, right: string) =>
  previewStructureMatchesRoute(left, right);

export function reducePreviewDocumentNavigation(
  state: PreviewDocumentNavigationState,
  event: PreviewDocumentNavigationEvent,
): PreviewDocumentNavigationState {
  switch (event.type) {
    case "route-sent": {
      if (isRoutePatternPath(event.routePath)) {
        return {
          status: "failed",
          key: event.key,
          routePath: event.routePath,
          reason: "pattern",
        };
      }
      const sameFrame = state.status !== "idle" && state.key === event.key;
      // Sent again while the same switch is under way (every new document
      // is sent the route): the clock keeps running from the first send.
      if (
        sameFrame &&
        state.status === "opening" &&
        samePage(state.routePath, event.routePath)
      ) {
        return state;
      }
      const from =
        sameFrame && state.status === "open"
          ? state.routePath
          : sameFrame && state.status === "opening"
            ? state.from
            : sameFrame && state.status === "elsewhere"
              ? state.framePath
              : null;
      return {
        status: "opening",
        key: event.key,
        routePath: event.routePath,
        from,
        startedAt: event.at,
      };
    }
    case "route-answered": {
      if (state.status === "idle" || state.key !== event.key) return state;
      if (state.status !== "opening" && state.status !== "failed") return state;
      if (state.status === "failed" && state.reason === "pattern") return state;
      if (event.routePath === null) {
        return state.status === "opening"
          ? {
              status: "failed",
              key: state.key,
              routePath: state.routePath,
              reason: "not-navigated",
            }
          : state;
      }
      // Late is still an answer: the page is there now, and says so.
      if (samePage(event.routePath, state.routePath)) {
        return { status: "open", key: state.key, routePath: state.routePath };
      }
      // Never the page asked for; the frame is somewhere else, and says so.
      return {
        status: "elsewhere",
        key: state.key,
        routePath: state.routePath,
        framePath: event.routePath,
      };
    }
    case "timed-out":
      if (
        state.status !== "opening" ||
        state.key !== event.key ||
        state.startedAt !== event.startedAt ||
        !samePage(state.routePath, event.routePath)
      ) {
        return state;
      }
      return {
        status: "failed",
        key: state.key,
        routePath: state.routePath,
        reason: "timeout",
      };
  }
}

/** What the canvas says, in the author's terms; null when there is nothing to say. */
export function previewDocumentNavigationNotice(
  state: PreviewDocumentNavigationState,
  previewKey: string | null,
  /** Whether the editor follows the frame to this path (a page it lists). */
  followsTo: (framePath: string) => boolean = () => false,
):
  | Readonly<{ kind: "status"; message: string }>
  | Readonly<{ kind: "alert"; message: string; retry: boolean }>
  | null {
  if (state.status === "idle" || state.key !== previewKey) return null;
  if (state.status === "opening") {
    // A document of the same page coming back (a reload) is not a switch.
    if (state.from !== null && samePage(state.from, state.routePath)) {
      return null;
    }
    return {
      kind: "status",
      message: `Opening ${state.routePath} in the preview… Canvas editing is paused until it shows.`,
    };
  }
  if (state.status === "failed") {
    const message =
      state.reason === "pattern"
        ? `${state.routePath} is a route pattern, not a page address, so the preview cannot open it.`
        : state.reason === "not-navigated"
          ? `The preview could not switch to ${state.routePath}. Retry Preview to reload it.`
          : `The preview did not open ${state.routePath}. Canvas editing stays paused. Retry Preview to reload it.`;
    // Reloading the preview cannot give a pattern an address.
    return { kind: "alert", message, retry: state.reason !== "pattern" };
  }
  if (state.status === "elsewhere") {
    return {
      kind: "status",
      message: followsTo(state.framePath)
        ? `Following the preview to ${state.framePath}…`
        : `The preview is showing ${state.framePath}, which is not a page the editor can open. Canvas editing is off there; open a page from the list to edit it.`,
    };
  }
  return null;
}
