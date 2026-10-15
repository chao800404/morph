import {
  formatPreviewServedInstance,
  type PreviewServedInstance,
  type PreviewServedInstanceReport,
} from "./preview-protocol";

/**
 * Notices a preview frame whose dev server was replaced underneath it.
 *
 * A start from any tab can lay the workspace out again and restart Vite on
 * the same address. The frame keeps running the modules the old instance
 * served, and nothing tells it: the new instance has no hot updates for files
 * written before it started, and every later sync of them is `unchanged`.
 * Asking whether the address serves cannot tell either — it does.
 *
 * So the page says which instance served it (`frameReady`), and the answers
 * the editor already gets — a sync's, a renewal's — say which one is serving
 * now (`observe`). A frame served by an instance that is no longer the one
 * serving is reloaded, once. Only the frame: no start, no reconnect, nothing
 * the author has pending; content reaches the new frame once it is on its
 * route (`createInstanceContentReplay`).
 *
 * Instances are only ordered inside one session, by serial. Across sessions
 * there is no order to trust, so an answer naming another session is checked
 * by one fresh question (`confirm`), and only that question's answer counts.
 * This decides about reloading and nothing else: what a sync answer means for
 * the sync is not its business.
 *
 * A reload is held while the frame cannot be replaced without losing what
 * only it holds — text being typed on the canvas, which the editor does not
 * have until it is committed (`canReload`). The frame is then kept, the author
 * is told once (`onDeferred`), and the reload happens when the edit ends
 * (`editEnded`), after its commit, if any, has reached the editor. A held
 * reload belongs to the frame it was decided for: if that frame is replaced
 * for another reason first, or the watch is disposed, it is dropped.
 */
export type PreviewInstanceWatch = {
  /** A frame came up, with what its page said served it. */
  frameReady(key: string, report: PreviewServedInstanceReport | null): void;
  /** An answer, sent while frame `key` was current, named this instance. */
  observe(key: string | null, instance: PreviewServedInstance | null): void;
  /** What made `canReload` false is over: a held reload may happen now. */
  editEnded(): void;
  dispose(): void;
};

export type PreviewInstanceWatchOptions = Readonly<{
  /** The frame now on screen. */
  currentKey(): string | null;
  /** Replaces frame `key`; nothing else. */
  reloadFrame(key: string): void;
  /** Asks, now, which instance is serving; null when it cannot say. */
  confirm(): Promise<PreviewServedInstance | null>;
  log(line: string): void;
  /** Whether the frame can be replaced now; absent means always. */
  canReload?(): boolean;
  /** A reload is being held; called once per held reload. */
  onDeferred?(reason: string): void;
}>;

type FrameState = {
  key: string;
  report: PreviewServedInstanceReport | null;
  reloaded: boolean;
  missingLogged: boolean;
  /** A confirmation is out; it is the only one this frame asks. */
  confirming: boolean;
  /** Why this frame is to be reloaded once it can be; null when it is not. */
  deferred: string | null;
};

export function createPreviewInstanceWatch(
  options: PreviewInstanceWatchOptions,
): PreviewInstanceWatch {
  let frame: FrameState | null = null;
  let disposed = false;
  // A frame loaded from two instances is reloaded once for the instance
  // serving. One that still is after that is not reloaded again for it.
  const mixedReloadedFor = new Set<string>();

  const current = (key: string | null): FrameState | null => {
    if (disposed || !frame || !key) return null;
    if (frame.key !== key || options.currentKey() !== key) return null;
    return frame;
  };

  const reload = (state: FrameState, reason: string) => {
    if (state.reloaded) return;
    if (options.canReload && !options.canReload()) {
      // Held, once: later answers for this frame add nothing to it.
      if (state.deferred !== null) return;
      state.deferred = reason;
      options.log(`[preview-instance] reload deferred | ${reason}`);
      options.onDeferred?.(reason);
      return;
    }
    state.reloaded = true;
    options.log(`[preview-instance] reload frame | ${reason}`);
    options.reloadFrame(state.key);
  };

  /** Whether `serving` is a later instance than the one `served`. */
  const isLater = (
    served: PreviewServedInstance,
    serving: PreviewServedInstance,
  ) => serving.session === served.session && serving.serial > served.serial;

  const startRound = (
    state: FrameState,
    decide: (serving: PreviewServedInstance) => void,
  ) => {
    // One question at a time, and none for a frame already on its way out
    // or already held for a reload.
    if (state.confirming || state.reloaded || state.deferred !== null) return;
    state.confirming = true;
    const settle = (serving: PreviewServedInstance | null) => {
      // Decides only for the frame it was asked for, while it is on screen;
      // a newer frame has its own question.
      if (current(state.key) !== state) return;
      state.confirming = false;
      if (serving) decide(serving);
    };
    options.confirm().then(settle, () => settle(null));
  };

  return {
    frameReady(key, report) {
      if (disposed || options.currentKey() !== key) return;
      const state: FrameState = {
        key,
        report,
        reloaded: false,
        missingLogged: false,
        confirming: false,
        deferred: null,
      };
      // A reload held for the frame this one replaces goes with it.
      frame = state;
      if (report?.kind !== "mixed") return;
      startRound(state, (serving) => {
        const id = formatPreviewServedInstance(serving);
        if (mixedReloadedFor.has(id)) {
          options.log(
            `[preview-instance] frame still loaded from two instances after a reload for ${id}; not reloading again`,
          );
          return;
        }
        mixedReloadedFor.add(id);
        reload(state, `loaded from two instances; serving ${id}`);
      });
    },
    observe(key, instance) {
      const state = current(key);
      if (!state || !instance) return;
      const report = state.report;
      if (!report || report.kind === "mixed") return;
      if (report.kind === "missing") {
        if (!state.missingLogged) {
          state.missingLogged = true;
          options.log(
            "[preview-instance] the page could not say which instance served all of it; not comparing",
          );
        }
        return;
      }
      const served = report.instance;
      if (instance.session === served.session) {
        // An older answer, or one about this frame's own instance.
        if (!isLater(served, instance)) return;
        reload(
          state,
          `served by ${formatPreviewServedInstance(served)}, serving ${formatPreviewServedInstance(instance)}`,
        );
        return;
      }
      // Another session: a sidecar that restarted, or an answer from one
      // that is gone. Only a fresh question tells which.
      startRound(state, (serving) => {
        if (serving.session === served.session && !isLater(served, serving)) {
          return;
        }
        reload(
          state,
          `served by ${formatPreviewServedInstance(served)}, confirmed serving ${formatPreviewServedInstance(serving)}`,
        );
      });
    },
    editEnded() {
      // Nothing after `dispose`. It also forgets the frame; this check does
      // not rely on that.
      if (disposed) return;
      const state = frame;
      if (!state || state.deferred === null) return;
      // Only for the frame it was held for, while that frame is on screen.
      // Once reloaded, the frame is on its way out and nothing reads this.
      if (options.currentKey() !== state.key) return;
      reload(state, state.deferred);
    },
    dispose() {
      disposed = true;
      frame = null;
    },
  };
}
