/**
 * The order and the right to proceed for theme file saves.
 *
 * Two rules, both of them about not losing an edit, and both previously kept
 * as a pair of bare `Map`s in refs among six thousand lines of editor:
 *
 * Saves for one theme run one at a time. They share a source generation, and
 * two in flight together means the second was prepared against a generation
 * the first has already moved past.
 *
 * A save whose revision is older than the newest one queued for that file does
 * not run. Typing produces a save per pause, so a slow first request and a fast
 * second one will finish out of order — and the older content, arriving last,
 * would be what the file is left holding.
 *
 * Kept free of React and of the server so both rules can be stated as tests
 * rather than reproduced by typing quickly in a browser.
 */
export type ThemeFileSaveQueue = {
  /**
   * Claims the next revision for a file, and returns it.
   *
   * The caller passes this back when the save finally runs, which is what makes
   * a superseded one recognisable.
   */
  claimRevision: (fileKey: string) => number;
  /** The newest revision claimed for a file, or 0 if none has been. */
  latestRevision: (fileKey: string) => number;
  /**
   * Runs `task` after everything already queued for `queueKey`, unless a newer
   * revision for `fileKey` was claimed in the meantime.
   */
  enqueue: <T>(args: {
    queueKey: string;
    fileKey: string;
    revision: number;
    task: () => Promise<T>;
    superseded: () => T;
  }) => Promise<T>;
  /** Whatever is still running for a queue, so a caller can await quiet. */
  pending: (queueKey: string) => Promise<unknown> | undefined;
};

export function createThemeFileSaveQueue(): ThemeFileSaveQueue {
  const revisions = new Map<string, number>();
  const queues = new Map<string, Promise<unknown>>();

  const latestRevision = (fileKey: string) => revisions.get(fileKey) ?? 0;

  return {
    latestRevision,
    claimRevision: (fileKey) => {
      const next = latestRevision(fileKey) + 1;
      revisions.set(fileKey, next);
      return next;
    },
    enqueue: ({ queueKey, fileKey, revision, task, superseded }) => {
      const previous = queues.get(queueKey) ?? Promise.resolve();
      // A failed save must not stop the ones behind it: the queue exists to
      // order writes, not to make one file's conflict everyone's problem.
      const next = previous
        .catch(() => {})
        .then(() => {
          if (revision < latestRevision(fileKey)) return superseded();
          return task();
        });
      queues.set(queueKey, next);
      return next;
    },
    pending: (queueKey) => queues.get(queueKey),
  };
}
