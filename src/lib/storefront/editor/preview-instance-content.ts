import { setFieldPathValue } from "./selection-taxonomy";
import {
  basisWithinOwnRange,
  rowsStillMatch,
  type ContentSnapshot,
  type SnapshotSection,
} from "./content-write-snapshot";
import type { PendingContentEntry } from "./pending-content-write";

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
 */

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
  /** Frame `key`, in ready round `round`, reported being on `routePath`. */
  structure(key: string, round: number, routePath: string): void;
  dispose(): void;
};

export type InstanceContentReplayOptions = Readonly<{
  /** Reads the latest content into the editor's accepted snapshots. */
  readLatest(): Promise<unknown>;
  /** Sends the content of the route on screen; `isCurrent` before each post. */
  replay(frame: InstanceReplayFrame, isCurrent: () => boolean): void;
  /** The read failed, so nothing was sent; a non-blocking notice. */
  onReadFailed(): void;
  /** The frame, ready round and route on screen now; null when none. */
  current(): InstanceReplayFrame | null;
  log(line: string): void;
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
    /** The new frame reported being on `routePath`. */
    onRoute: boolean;
  };
  let disposed = false;
  let pending: Pending | null = null;

  const drop = (state: Pending, why: string) => {
    if (pending !== state) return;
    pending = null;
    options.log(`[preview-instance] content replay dropped | ${why}`);
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
    pending = null;
    options.log(
      `[preview-instance] content replayed | round ${frame.round} | ${frame.routePath}`,
    );
    options.replay(
      frame,
      () => !disposed && sameFrame(options.current(), frame),
    );
  };

  return {
    frameReloaded(key, round, routePath) {
      if (disposed) return;
      pending = {
        key,
        routePath,
        read: { state: "unread" },
        afterRound: round,
        round: null,
        onRoute: false,
      };
    },
    frameReady(key, round) {
      const state = pending;
      if (disposed || !state) return;
      if (state.round === null && state.key === key && round > state.afterRound) {
        state.round = round;
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
    structure(key, round, routePath) {
      const state = pending;
      if (disposed || !state || state.round === null) return;
      if (state.key !== key || state.round !== round) return;
      if (routePath !== state.routePath) {
        drop(state, "the frame is on another route");
        return;
      }
      state.onRoute = true;
      tryReplay(state);
    },
    dispose() {
      disposed = true;
      pending = null;
    },
  };
}
