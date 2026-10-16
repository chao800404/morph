import { setFieldPathValue } from "./selection-taxonomy";
import {
  basisWithinOwnRange,
  rowsStillMatch,
  type ContentSnapshot,
  type SnapshotSection,
} from "./content-write-snapshot";
import type { PendingContentEntry } from "./pending-content-write";
import { previewStructureMatchesRoute } from "./preview-structure-route";

/**
 * Brings the frame that replaced one whose dev server was restarted
 * (`createPreviewInstanceWatch`) up to the content the editor holds, once.
 *
 * A client-only preview page renders from the content snapshot written when
 * a preview last started, from any tab. The frame it replaced had been kept
 * current by this editor's content messages as the author typed; the new one
 * has only that snapshot, which a save made since does not reach. So once
 * the new frame is on the route it was reloaded on, this sends each section
 * there its content, once, through the message an edit uses — no start, no
 * reload, no save, nothing written anywhere.
 *
 * What is sent is the latest content the write path accepts: the document
 * snapshot every write is composed on (`content-write-snapshot.ts`), read
 * once more when the reloaded frame comes up — a read and this tab's own write
 * answers are ordered by draft generation there, whichever arrives first —
 * with the pending fields the write path would still send on its own on top
 * (`instanceReplaySection`). If that read fails nothing is sent: the copy
 * the editor holds may be older than what the new page loaded, and showing
 * it would put older content on the canvas without saying so.
 *
 * One-shot, and bound to the reload it was armed for: the frame key, the
 * ready round the new frame came up in, and the route the reload happened
 * on. Anything else first — another frame, another route — drops it.
 * Everything sent, including the second post once media is signed, checks
 * all three again (`isCurrent`). Other frame replacements are not this
 * module's business.
 *
 * "On the route" is the new frame's own word for it, and nothing else: its
 * answer (`routeApplied`) to the latest set-route this editor sent it, in
 * its ready round, naming the route. Every frame boots on `/`; content posted
 * before it arrives is applied to that page's content, not this route's, and
 * is gone once the route is set. So the route having been sent does not
 * count, nor does a structure report, with a route or without one. An answer
 * of null means the page has no router — it stays on its one page, whose
 * content is kept by its address — and counts only from a frame that never
 * named a route. When placement cannot be confirmed, nothing is sent: the
 * replay is given up with a notice (`onUnconfirmed`), including when no
 * answer comes in time, as from a page on a bridge older than the answer.
 * Giving up sends, saves, reloads and clears nothing.
 */

/** How long the frame that came up has to confirm its route. */
export const INSTANCE_REPLAY_CONFIRM_TIMEOUT_MS = 30_000;

/** The content one section is replayed with. */
export type InstanceReplaySection = Readonly<{
  props: Record<string, unknown>;
  enabled?: boolean;
}>;

/**
 * A section as the latest accepted document holds it, with the pending
 * fields the write path would still send on its own on top; null when there
 * is nothing to send.
 *
 * A pending field is put on the canvas only if a write composed now on
 * `snapshot` would carry it, by the same checks `selectCurrentContentFields`
 * makes: not refused by the source, captured on the current source
 * generation, no parent edit that is not, made on a copy this one follows
 * only through this session's own writes (`basisWithinOwnRange`), and still
 * in the same rows (`rowsStillMatch`). A field the source refused stays
 * with the Inspector and its recovery.
 *
 * `unconfirmed` is the write this section sent and never heard back about.
 * Whether it landed is decided the way the existing check decides it, by
 * what the server holds: its fields are not put on the canvas from here,
 * so they show only if the read the snapshot came from holds them. Its
 * bookkeeping is not touched.
 */
export function instanceReplaySection(args: {
  snapshot: ContentSnapshot | undefined;
  sectionId: string;
  pending: PendingContentEntry | undefined;
  unconfirmed: PendingContentEntry | undefined;
  sourceGeneration: number;
}): InstanceReplaySection | null {
  const { snapshot, sectionId, pending, unconfirmed, sourceGeneration } = args;
  const accepted: SnapshotSection | undefined = snapshot?.sections.find(
    (section) => section.id === sectionId,
  );
  const stored = { ...((accepted?.props ?? {}) as Record<string, unknown>) };
  let merged: Record<string, unknown> = { ...stored };
  let applied = false;
  if (pending?.fields) {
    const fields = pending.fields;
    const sent = unconfirmed?.fields;
    const current = (path: string) => {
      const field = fields[path]!;
      return !field.rejected && field.sourceGeneration === sourceGeneration;
    };
    for (const path of Object.keys(fields)) {
      const field = fields[path]!;
      if (!current(path)) continue;
      // The very input the unanswered write sent: the server decides.
      if (unconfirmed && (!sent || sent[path] === field)) continue;
      if (
        Object.keys(fields).some(
          (parent) => path.startsWith(`${parent}.`) && !current(parent),
        )
      ) {
        continue;
      }
      const root = path.split(".")[0]!;
      if (
        stored[root] === undefined &&
        Object.keys(fields).some(
          (other) => other.split(".")[0] === root && !current(other),
        )
      ) {
        continue;
      }
      if (snapshot) {
        // Checked against what the field is composed onto: a list nothing
        // stores yet is the author's own copy of its defaults.
        const base =
          stored[root] === undefined
            ? { ...stored, [root]: pending.props[root] }
            : stored;
        if (
          !basisWithinOwnRange(snapshot, field.basisDraftGeneration) ||
          !rowsStillMatch(base, path, field.rows)
        ) {
          continue;
        }
      }
      if (merged[root] === undefined && path.includes(".")) {
        merged[root] = pending.props[root];
      }
      merged = setFieldPathValue(merged, path, field.value);
      applied = true;
    }
  } else if (
    pending &&
    !unconfirmed &&
    pending.expectedSourceGeneration === sourceGeneration
  ) {
    merged = { ...merged, ...pending.props };
    applied = true;
  }
  if (!accepted && !applied) return null;
  let enabled = accepted?.enabled;
  if (typeof merged.enabled === "boolean") enabled = merged.enabled;
  delete merged.enabled;
  return enabled === undefined ? { props: merged } : { props: merged, enabled };
}

/** The frame, ready round and route a replay is for. */
export type InstanceReplayFrame = Readonly<{
  key: string;
  round: number;
  routePath: string;
}>;

export type InstanceContentReplay = {
  /**
   * The watch reloaded the frame on route `routePath`; the reloaded frame
   * comes up under `key`, and the one it replaces came up in ready round
   * `round`.
   */
  frameReloaded(key: string, round: number, routePath: string): void;
  /** Frame `key` came up; `round` counts every ready, of any frame. */
  frameReady(key: string, round: number): void;
  /**
   * Frame `key`, in ready round `round`, was sent route `routePath` as
   * request `requestId`. Only an answer to the latest request counts.
   */
  routeSent(
    key: string,
    round: number,
    routePath: string,
    requestId: number,
  ): void;
  /**
   * Frame `key`, in ready round `round`, reported its structure, naming the
   * route it is on or none. Never releases the replay: a report naming a
   * route says only that the frame has a router.
   */
  structure(key: string, round: number, routePath: string | undefined): void;
  /**
   * Frame `key`, in ready round `round`, answered request `requestId`: it is
   * on `routePath`, or (null) it has no router.
   */
  routeApplied(
    key: string,
    round: number,
    requestId: number,
    routePath: string | null,
  ): void;
  dispose(): void;
};

export type InstanceContentReplayOptions = Readonly<{
  /** Reads the latest content into the editor's accepted snapshots. */
  readLatest(): Promise<unknown>;
  /** Sends the content of the route on screen; `isCurrent` before each post. */
  replay(frame: InstanceReplayFrame, isCurrent: () => boolean): void;
  /** The read failed, so nothing was sent; a non-blocking notice. */
  onReadFailed(): void;
  /** The frame did not confirm its route, so nothing was sent; a non-blocking notice. */
  onUnconfirmed(): void;
  /** The frame, ready round and route on screen now; null when none. */
  current(): InstanceReplayFrame | null;
  log(line: string): void;
  /** Defaults to `INSTANCE_REPLAY_CONFIRM_TIMEOUT_MS`. */
  confirmTimeoutMs?: number;
}>;

const sameFrame = (
  left: InstanceReplayFrame | null,
  right: InstanceReplayFrame,
) =>
  left !== null &&
  left.key === right.key &&
  left.round === right.round &&
  left.routePath === right.routePath;

export function createInstanceContentReplay(
  options: InstanceContentReplayOptions,
): InstanceContentReplay {
  type Read = { state: "unread" | "reading" | "read" | "failed" };
  type Pending = {
    key: string;
    routePath: string;
    read: Read;
    /** The ready round of the frame being replaced; set while armed. */
    afterRound: number;
    /** The new frame's ready round, once it came up. */
    round: number | null;
    /** The latest set-route request sent to the new frame in its round. */
    routeRequest: number | null;
    /** The new frame named a route: it has a router, so null is no answer. */
    namedRoute: boolean;
    /** The new frame answered the latest request: it is on `routePath`. */
    onRoute: boolean;
    /** Gives up when the new frame has not confirmed its route in time. */
    timer: ReturnType<typeof setTimeout> | null;
  };
  let disposed = false;
  let pending: Pending | null = null;

  const end = (state: Pending) => {
    pending = null;
    if (state.timer !== null) clearTimeout(state.timer);
    state.timer = null;
  };

  const drop = (state: Pending, why: string) => {
    if (pending !== state) return;
    end(state);
    options.log(`[preview-instance] content replay dropped | ${why}`);
  };

  // Placement could not be confirmed: nothing is sent, and the author is
  // told. Nothing else — no save, no reload, nothing cleared.
  const giveUp = (state: Pending, why: string) => {
    if (pending !== state) return;
    end(state);
    options.log(`[preview-instance] content replay given up | ${why}`);
    options.onUnconfirmed();
  };

  const tryReplay = (state: Pending) => {
    if (disposed || pending !== state) return;
    if (state.round === null || !state.onRoute) return;
    if (state.read.state === "unread" || state.read.state === "reading") return;
    if (state.read.state === "failed") {
      drop(state, "the content read failed");
      options.onReadFailed();
      return;
    }
    const frame: InstanceReplayFrame = {
      key: state.key,
      round: state.round,
      routePath: state.routePath,
    };
    if (!sameFrame(options.current(), frame)) {
      drop(state, "the frame or route changed");
      return;
    }
    end(state);
    options.log(
      `[preview-instance] content replayed | round ${frame.round} | ${frame.routePath}`,
    );
    options.replay(
      frame,
      () => !disposed && sameFrame(options.current(), frame),
    );
  };

  /** The new frame, in its ready round: the only one whose word counts. */
  const awaiting = (key: string, round: number) => {
    const state = pending;
    if (disposed || !state || state.round === null) return null;
    return state.key === key && state.round === round ? state : null;
  };

  return {
    frameReloaded(key, round, routePath) {
      if (disposed) return;
      if (pending) end(pending);
      pending = {
        key,
        routePath,
        read: { state: "unread" },
        afterRound: round,
        round: null,
        routeRequest: null,
        namedRoute: false,
        onRoute: false,
        timer: null,
      };
    },
    frameReady(key, round) {
      const state = pending;
      if (disposed || !state) return;
      if (state.round === null && state.key === key && round > state.afterRound) {
        state.round = round;
        state.timer = setTimeout(() => {
          state.timer = null;
          if (!state.onRoute) {
            giveUp(state, "the frame did not confirm its route in time");
          }
        }, options.confirmTimeoutMs ?? INSTANCE_REPLAY_CONFIRM_TIMEOUT_MS);
        // Read once the frame it is for has come up: anything saved while it
        // loaded is in it, and a frame that never comes up costs no read.
        const read = state.read;
        read.state = "reading";
        options.readLatest().then(
          () => {
            read.state = "read";
            tryReplay(state);
          },
          (error: unknown) => {
            read.state = "failed";
            options.log(
              `[preview-instance] content read failed | ${
                error instanceof Error ? error.message : String(error)
              }`,
            );
            tryReplay(state);
          },
        );
        return;
      }
      // Any other frame, for whatever reason it came up, is not this one.
      drop(state, "another frame came up");
    },
    routeSent(key, round, routePath, requestId) {
      const state = awaiting(key, round);
      if (!state) return;
      if (!previewStructureMatchesRoute(routePath, state.routePath)) {
        drop(state, "the frame was sent another route");
        return;
      }
      // Only the answer to this request counts from now on.
      state.routeRequest = requestId;
      state.onRoute = false;
    },
    structure(key, round, routePath) {
      const state = awaiting(key, round);
      if (state && routePath !== undefined) state.namedRoute = true;
    },
    routeApplied(key, round, requestId, routePath) {
      const state = awaiting(key, round);
      if (!state || state.routeRequest === null) return;
      if (requestId !== state.routeRequest || state.onRoute) return;
      if (routePath === null) {
        // "No router" from a frame that showed it has one confirms nothing.
        if (state.namedRoute) {
          giveUp(state, "a frame with a router answered that it has none");
          return;
        }
      } else {
        state.namedRoute = true;
        if (!previewStructureMatchesRoute(routePath, state.routePath)) {
          giveUp(state, "the frame confirmed another route");
          return;
        }
      }
      state.onRoute = true;
      tryReplay(state);
    },
    dispose() {
      disposed = true;
      if (pending) end(pending);
      pending = null;
    },
  };
}
