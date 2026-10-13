/**
 * Holds a navigation until the edits waiting to be saved have been sent and
 * answered.
 *
 * An edit waits out a short debounce before anything is sent, and a page that
 * goes away inside that window takes the edit with it: no request ever left.
 * So a navigation asks this guard first. With nothing pending it goes at once.
 * Otherwise the waiting writes are sent now, through the editor's own save
 * paths (`flush`), and the navigation goes once they are answered as stored.
 *
 * What it never does is decide for the author when the save did not land, or
 * keep them waiting with no way out:
 *
 * - A save that failed, was refused, or is held (writes paused, an earlier
 *   save unanswered, a document that moved) stops the navigation and says why.
 *   The author stays, or leaves knowing the edit is not stored.
 * - A save that is slow shows the same choice while it runs.
 * - Editing again while a navigation waits cancels it. The author is plainly
 *   still here, and the new edit is not part of what was saved.
 *
 * `flush` is expected to send only what the save paths would send on their
 * own: nothing behind a paused gate, nothing whose last save went unanswered,
 * nothing refused for a conflict. Those are what make it answer "not saved".
 *
 * Kept free of React and of the router so the order can be stated as tests,
 * with the timer and every outcome injected.
 */

export type EditorLeaveKind =
  /** The editor itself goes away: whatever is not stored is lost. */
  | "leave-editor"
  /** Another page in the same editor: unsaved edits stay in this tab. */
  | "switch-page";

type EditorLocation = {
  pathname: string;
  search: Readonly<Record<string, unknown>>;
};

/**
 * What a navigation does to the editor, or null when it stays on the same
 * page (a selected section, a viewport, a canonicalised URL).
 */
export function classifyEditorNavigation(
  current: EditorLocation,
  next: EditorLocation,
): EditorLeaveKind | null {
  if (current.pathname !== next.pathname) return "leave-editor";
  // The router strips `routePath=/`, so an absent one is the home page.
  const routePath = (search: EditorLocation["search"]) =>
    typeof search.routePath === "string" && search.routePath
      ? search.routePath
      : "/";
  if (routePath(current.search) !== routePath(next.search)) {
    return "switch-page";
  }
  const templateId = (search: EditorLocation["search"]) =>
    typeof search.templateId === "string" && search.templateId
      ? search.templateId
      : null;
  const from = templateId(current.search);
  const to = templateId(next.search);
  // Filling in a missing id is the URL being completed, not a page change.
  if (from && to && from !== to) return "switch-page";
  return null;
}

export type EditorLeaveFlush =
  | { saved: true }
  | { saved: false; reason: string };

export type EditorLeavePrompt =
  /**
   * Text is still being typed somewhere the editor cannot send from (the
   * canvas). The author finishes it, stays, or discards it; nothing is
   * decided for them.
   */
  | { phase: "open-edit"; kind: EditorLeaveKind }
  /** Sending, and taking longer than a glance. */
  | { phase: "saving"; kind: EditorLeaveKind }
  | { phase: "not-saved"; kind: EditorLeaveKind; reason: string };

export type EditorLeaveGuardPorts = {
  hasPendingWrites: (kind: EditorLeaveKind) => boolean;
  /** Whether an edit is open whose text the save paths do not have yet. */
  hasOpenEdit?: () => boolean;
  /**
   * Ends the open edit, keeping its text (`commit`) — which hands it to the
   * save paths — or putting it back. Resolves true once it has ended, false
   * when it did not answer.
   */
  finishOpenEdit?: (commit: boolean) => Promise<boolean>;
  /** Sends what is waiting, now, and says whether all of it is stored. */
  flush: (kind: EditorLeaveKind) => Promise<EditorLeaveFlush>;
  /** Shows, replaces or (with null) closes the question to the author. */
  onPrompt: (prompt: EditorLeavePrompt | null) => void;
  /**
   * The author chose to go without the save landing. Whatever has not been
   * sent must not be sent after they left.
   */
  discard: (kind: EditorLeaveKind) => void;
  /** The navigation was stopped, by the author or by their next edit. */
  onBlocked?: (
    kind: EditorLeaveKind,
    why: "stayed" | "kept-editing" | "superseded",
  ) => void;
  /** How long a save may run before the author is offered a way out. */
  promptDelayMs?: number;
  timers?: {
    set: (run: () => void, delayMs: number) => ReturnType<typeof setTimeout>;
    clear: (timer: ReturnType<typeof setTimeout>) => void;
  };
};

export type EditorLeaveGuard = {
  /** Resolves true when the navigation must not happen. */
  request: (kind: EditorLeaveKind) => Promise<boolean>;
  /** The author stays: the navigation is dropped. */
  stay: () => void;
  /**
   * The author goes without waiting for, or despite, the save. A request
   * already sent is not recalled and may still land; leaving only means
   * nothing more is sent for them.
   */
  leave: () => void;
  /** The author keeps the open edit's text; the navigation then saves it. */
  finishEdit: () => void;
  /**
   * The author edited something; a waiting navigation is cancelled. Not
   * called for the commit an author-requested finish produces.
   */
  noteInput: () => void;
  readonly waiting: boolean;
};

export const EDITOR_LEAVE_PROMPT_DELAY_MS = 400;

const OPEN_EDIT_NO_ANSWER =
  "The text being edited on the page could not be finished, so it was not saved.";

const CHANGED_WHILE_SAVING =
  "Something changed while it was being saved. Your changes are kept.";

export function createEditorLeaveGuard(
  ports: EditorLeaveGuardPorts,
): EditorLeaveGuard {
  const timers = ports.timers ?? {
    set: (run: () => void, delayMs: number) => setTimeout(run, delayMs),
    clear: (timer: ReturnType<typeof setTimeout>) => clearTimeout(timer),
  };
  const promptDelayMs = ports.promptDelayMs ?? EDITOR_LEAVE_PROMPT_DELAY_MS;

  type Attempt = {
    kind: EditorLeaveKind;
    resolve: (block: boolean) => void;
    promptTimer: ReturnType<typeof setTimeout> | null;
    /** Waiting on the author about an open edit. */
    askingAboutEdit: boolean;
  };
  let current: Attempt | null = null;

  const settle = (
    attempt: Attempt,
    block: boolean,
    why?: "stayed" | "kept-editing" | "superseded",
  ) => {
    if (current !== attempt) return;
    current = null;
    if (attempt.promptTimer !== null) timers.clear(attempt.promptTimer);
    ports.onPrompt(null);
    if (block && why) ports.onBlocked?.(attempt.kind, why);
    attempt.resolve(block);
  };

  const notSaved = (attempt: Attempt, reason: string) => {
    if (current !== attempt) return;
    if (attempt.promptTimer !== null) {
      timers.clear(attempt.promptTimer);
      attempt.promptTimer = null;
    }
    ports.onPrompt({ phase: "not-saved", kind: attempt.kind, reason });
  };

  /** Sends what is waiting for this attempt, and goes once it is stored. */
  const save = (attempt: Attempt) => {
    const { kind } = attempt;
    attempt.promptTimer = timers.set(() => {
      attempt.promptTimer = null;
      if (current === attempt) ports.onPrompt({ phase: "saving", kind });
    }, promptDelayMs);

    let flushing: Promise<EditorLeaveFlush>;
    try {
      flushing = ports.flush(kind);
    } catch (error) {
      flushing = Promise.reject(error);
    }
    flushing.then(
      (result) => {
        if (!result.saved) return notSaved(attempt, result.reason);
        // Stored is judged by what is still held now, not by the answer:
        // an edit made since is not covered by it.
        if (ports.hasPendingWrites(kind)) {
          return notSaved(attempt, CHANGED_WHILE_SAVING);
        }
        settle(attempt, false);
      },
      (error: unknown) =>
        notSaved(
          attempt,
          error instanceof Error && error.message
            ? error.message
            : "Your changes could not be saved.",
        ),
    );
  };

  return {
    request: (kind) => {
      // A newer navigation replaces one still waiting; only one may go.
      if (current) settle(current, true, "superseded");
      const openEdit = ports.hasOpenEdit?.() ?? false;
      if (!openEdit && !ports.hasPendingWrites(kind)) {
        return Promise.resolve(false);
      }

      return new Promise<boolean>((resolve) => {
        const attempt: Attempt = {
          kind,
          resolve,
          promptTimer: null,
          askingAboutEdit: openEdit,
        };
        current = attempt;
        // An open edit is asked about first: its text is not in the save
        // paths yet, so there is nothing to send until the author says.
        if (openEdit) {
          ports.onPrompt({ phase: "open-edit", kind });
          return;
        }
        save(attempt);
      });
    },
    finishEdit: () => {
      const attempt = current;
      if (!attempt || !attempt.askingAboutEdit) return;
      attempt.askingAboutEdit = false;
      const finishing = ports.finishOpenEdit?.(true) ?? Promise.resolve(true);
      finishing.then(
        (ended) => {
          if (current !== attempt) return;
          if (!ended) return notSaved(attempt, OPEN_EDIT_NO_ANSWER);
          ports.onPrompt(null);
          if (!ports.hasPendingWrites(attempt.kind)) {
            return settle(attempt, false);
          }
          save(attempt);
        },
        () => notSaved(attempt, OPEN_EDIT_NO_ANSWER),
      );
    },
    stay: () => {
      if (current) settle(current, true, "stayed");
    },
    leave: () => {
      const attempt = current;
      if (!attempt) return;
      // The open edit's text is put back, not sent: leaving was the choice.
      if (attempt.askingAboutEdit) void ports.finishOpenEdit?.(false);
      ports.discard(attempt.kind);
      settle(attempt, false);
    },
    noteInput: () => {
      // Any input, including while an open edit is being finished. The one
      // commit that finishing produces is told apart by the caller, which
      // does not report it (`isRequestedInlineFinishCommit`).
      if (current) settle(current, true, "kept-editing");
    },
    get waiting() {
      return current !== null;
    },
  };
}
