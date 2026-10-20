/**
 * Holding canvas posts back while an inline text edit is open (C5, design v3
 * §2-§3), as pure functions the editor shell steps.
 *
 * While the author types on the canvas, the text lives only in the frame. A
 * content post that re-renders the section being typed in can take the
 * edited element away, and the edit with it. So the editor holds its canvas
 * posts — `update-section-props` and `update-selection-field`, nothing else
 * and nothing it saves — until the edit ends, and then sends them.
 *
 * - M1: a flush replays the held posts in their original global order,
 *   across sections and including selection-field posts. Each goes through
 *   the editor's own poster when it is sent, so the hidden check V(S) and
 *   every other check on the way are decided then, not when it was held.
 * - M2: `compactSectionUpdates` merges consecutive posts to one section only
 *   where the merge is exact for both receivers (the built-in route's
 *   `applyPreviewSectionProps` and the Theme bridge's `updatePreviewContent`).
 * - M3: a media-signing repost keeps its place; its revision check is asked
 *   when it is flushed, not when it is held.
 * - E1-E5: a ready from a new document ends the edit as lost and discards
 *   what it held (the existing content replay sends that document what the
 *   editor holds); a key change or another loss does the same; a second
 *   close, or one with no edit open, does nothing; there are no timers.
 *
 * A post is also tagged with the page it was made for (`scope`). A flush
 * sends only the posts made for the page on screen: a page switch that went
 * ahead while the edit could not be finished must not carry one page's
 * values to another page's slot of the same id.
 */

/** One `update-section-props` post, as the editor's poster would send it. */
export type SectionUpdateEntry = Readonly<{
  kind: "section";
  sectionId: string;
  props?: Readonly<Record<string, unknown>>;
  enabled?: boolean;
  resetKeys?: readonly string[];
  /**
   * M3: the repost's own check (its section revision, its replay frame), for
   * a post made once media was signed. Asked at flush. An entry carrying one
   * is never merged with another.
   */
  stillCurrent?: () => boolean;
  /** The page it was made for; posts for different pages never merge. */
  scope?: string;
  /**
   * Rebuilt at flush from what the editor holds (`rebuildCommittedSections`),
   * not held: its props are stored values, which the editor still resolves
   * for the canvas (signed media) when it sends them. Never merged.
   */
  rebuilt?: true;
}>;

/** One `update-selection-field` post: it writes to the section it names. */
export type SelectionFieldEntry = Readonly<{
  kind: "field";
  sectionId: string;
  fieldKey: string;
  fieldPath: string | null;
  value: string;
  scope?: string;
}>;

export type PreviewUpdateEntry = SectionUpdateEntry | SelectionFieldEntry;

function isMergeable(entry: PreviewUpdateEntry): entry is SectionUpdateEntry {
  return (
    entry.kind === "section" &&
    entry.enabled === undefined &&
    entry.stillCurrent === undefined &&
    entry.rebuilt === undefined
  );
}

/**
 * Two consecutive posts to one section, both with `enabled` undefined, as one.
 *
 * P = (P1 - R1 - R2) overlaid by (P2 - R2); R = (R1 - keys(P2)) ∪ R2.
 * `props` stays absent when neither post had any: on the bridge a post with
 * props creates the slot, and one without never does.
 */
export function mergeSectionUpdates(
  first: SectionUpdateEntry,
  second: SectionUpdateEntry,
): SectionUpdateEntry {
  const r1 = new Set(first.resetKeys ?? []);
  const r2 = new Set(second.resetKeys ?? []);
  const p2Keys = new Set(Object.keys(second.props ?? {}));
  let props: Record<string, unknown> | undefined;
  if (first.props || second.props) {
    props = {};
    for (const [key, value] of Object.entries(first.props ?? {})) {
      if (!r1.has(key) && !r2.has(key)) props[key] = value;
    }
    for (const [key, value] of Object.entries(second.props ?? {})) {
      if (!r2.has(key)) props[key] = value;
    }
  }
  const resetKeys = [
    ...new Set([...[...r1].filter((key) => !p2Keys.has(key)), ...r2]),
  ];
  return {
    kind: "section",
    sectionId: second.sectionId,
    ...(props ? { props } : {}),
    ...(resetKeys.length > 0 ? { resetKeys } : {}),
    ...(second.scope === undefined ? {} : { scope: second.scope }),
  };
}

/**
 * M2: merges each run of consecutive posts to the same section, made for the
 * same page, in which every post has `enabled` undefined and no flush-time
 * check. Anything else is a barrier: a post with `enabled` defined, a post to
 * another section or page, a selection-field post, a signed repost, a
 * rebuilt post. Order is never changed.
 */
export function compactSectionUpdates(
  entries: readonly PreviewUpdateEntry[],
): PreviewUpdateEntry[] {
  const compacted: PreviewUpdateEntry[] = [];
  for (const entry of entries) {
    const last = compacted[compacted.length - 1];
    if (
      last &&
      isMergeable(last) &&
      isMergeable(entry) &&
      last.sectionId === entry.sectionId &&
      last.scope === entry.scope
    ) {
      compacted[compacted.length - 1] = mergeSectionUpdates(last, entry);
    } else {
      compacted.push(entry);
    }
  }
  return compacted;
}

/** What one held queue belongs to (E3). */
export type DeferralTag = Readonly<{
  previewKey: string | null;
  readyRound: number;
  editSeq: number;
}>;

/** A section an inline commit landed on during the open edit, and its page. */
export type CommittedSection = Readonly<{ sectionId: string; scope?: string }>;

export type DeferralState = Readonly<{
  previewKey: string | null;
  /** Counts every ready that replaced the document. */
  readyRound: number;
  /** Counts every edit opened. */
  editSeq: number;
  /** The open edit's tag; null when none is open. */
  open: DeferralTag | null;
  /** Posts held while the edit is open, in the order they were made. */
  queue: readonly PreviewUpdateEntry[];
  /** Sections an inline commit landed on during the open edit. */
  committed: readonly CommittedSection[];
  /**
   * The content replay was armed for a lost edit (`armReplay`) and has not
   * settled yet: neither replayed nor given up (`replay-settled`).
   */
  replayArmed: boolean;
}>;

type SectionProps = Readonly<Record<string, unknown>>;

/**
 * Where a committed section is rebuilt from at flush. Read-only getters,
 * asked once per committed section when the flush runs; the model calls
 * nothing else, so it can neither save nor resend.
 *
 * The model does not choose a copy. `storedCopy` is the editor's own answer
 * to "which accepted copy is the newest valid one", the decision
 * `newestAcceptedCopy` makes (content-write-snapshot.ts) and the inline
 * commit handler reads it by: the snapshot's section when it answers
 * "snapshot", the context copy when it answers "context". Undefined when the
 * editor holds no copy of the section; its held posts are then replayed as
 * they are.
 *
 * `pendingProps` is the section's pending entry's props, put on top the way
 * the commit handler composes its compared copy.
 */
export type RebuildSource = Readonly<{
  storedCopy: (sectionId: string) => SectionProps | undefined;
  pendingProps: (sectionId: string) => SectionProps | undefined;
}>;

export type FlushOptions = Readonly<{
  /** M2 after everything else; off unless asked. */
  compact?: boolean;
  /** Turns on the committed-section rebuild (`rebuildCommittedSections`). */
  rebuildFrom?: RebuildSource;
  /** Whether a post made for `scope` is for the page on screen; all are when absent. */
  inScope?: (scope: string | undefined) => boolean;
}>;

export type DeferralEvent =
  | Readonly<{ type: "editing"; editing: boolean }>
  /**
   * A ready the document identity took as a new document (`verified`), or
   * one with no id, which cannot be told from the same document again.
   */
  | Readonly<{ type: "ready"; verified: boolean }>
  | Readonly<{ type: "key-change"; previewKey: string | null }>
  /** The edit ended unfinished for another reason than a ready or a key change. */
  | Readonly<{ type: "lost" }>
  | Readonly<{ type: "post"; entry: PreviewUpdateEntry }>
  /**
   * An inline commit to `sectionId`. Its save and acknowledgement are not
   * this model's business; the post that echoes it to the canvas, when there
   * is one, is held or sent like any other post, and while an edit is open
   * the section is marked for the rebuild at flush.
   */
  | Readonly<{
      type: "commit";
      sectionId: string;
      scope?: string;
      echo?: PreviewUpdateEntry;
    }>
  /** The armed replay replayed, gave up with its notice, or failed its read. */
  | Readonly<{ type: "replay-settled" }>;

export type DeferralOutput = Readonly<{
  /** Posts to send now, in this order, each through the poster (V(S) there). */
  posts: readonly PreviewUpdateEntry[];
  /** The edit ended: finished (true), or lost (false) as on a key change. */
  editEnded?: Readonly<{ finished: boolean }>;
  /**
   * Arm the existing content replay for this frame before its ready is
   * handed on (`frameReloaded`, then `frameReady`): a ready ended an open
   * edit and the posts it held were discarded, or a new document replaced
   * one whose replay for such an edit had not settled.
   */
  armReplay?: true;
  /**
   * An id-less ready arrived while a replay armed for a lost edit had not
   * settled. The replay module drops it on that ready with a log line only;
   * the author is told with the existing `onUnconfirmed` notice instead.
   * Without an id a duplicate cannot be told from a new document, so nothing
   * is re-armed on its word.
   */
  notice?: "replay-unconfirmed";
}>;

export function initialDeferralState(
  previewKey: string | null,
): DeferralState {
  return {
    previewKey,
    readyRound: 0,
    editSeq: 0,
    open: null,
    queue: [],
    committed: [],
    replayArmed: false,
  };
}

function sameTag(left: DeferralTag | null, right: DeferralTag): boolean {
  return (
    left !== null &&
    left.previewKey === right.previewKey &&
    left.readyRound === right.readyRound &&
    left.editSeq === right.editSeq
  );
}

/** M3: a post with a flush-time check is sent only if it still holds. */
function sendable(entry: PreviewUpdateEntry): boolean {
  return entry.kind !== "section" || !entry.stillCurrent || entry.stillCurrent();
}

/**
 * Each committed section's held posts, replaced by one post rebuilt now from
 * `source`: the stored copy the editor decides is newest, pending on top.
 *
 * An inline commit's echo is composed when the commit arrives, from a copy
 * that can predate posts held before it; replayed in order it is the last
 * word on the section, and a stale base wins. So for a section a commit
 * landed on, what is sent is what the editor holds at flush:
 *
 * - `props`: that stored copy with the pending props on top, whole;
 * - `resetKeys`: every key the section's held posts reset, less those the
 *   rebuilt props set again — a key reset and not set again is not in what
 *   the editor holds, and merging alone would leave the frame's old value;
 * - `enabled`: the last one the section's held posts defined, if any;
 * - its position: that of the section's last held post. Other sections, and
 *   selection-field posts, keep their order.
 *
 * Signed reposts for the section are among the posts replaced. A section the
 * editor holds no stored copy of keeps its held posts as they are.
 */
export function rebuildCommittedSections(
  queue: readonly PreviewUpdateEntry[],
  committed: readonly string[],
  source: RebuildSource,
): PreviewUpdateEntry[] {
  const rebuilt = new Map<string, SectionUpdateEntry>();
  const lastIndex = new Map<string, number>();
  for (const sectionId of new Set(committed)) {
    const stored = source.storedCopy(sectionId);
    if (!stored) continue;
    const props = { ...stored, ...(source.pendingProps(sectionId) ?? {}) };
    const own = queue.filter(
      (entry): entry is SectionUpdateEntry =>
        entry.kind === "section" && entry.sectionId === sectionId,
    );
    const reset = new Set(own.flatMap((entry) => entry.resetKeys ?? []));
    for (const key of Object.keys(props)) reset.delete(key);
    let enabled: boolean | undefined;
    for (const entry of own) if (entry.enabled !== undefined) enabled = entry.enabled;
    rebuilt.set(sectionId, {
      kind: "section",
      sectionId,
      props,
      ...(enabled === undefined ? {} : { enabled }),
      ...(reset.size > 0 ? { resetKeys: [...reset] } : {}),
      rebuilt: true,
    });
    let last = -1;
    queue.forEach((entry, index) => {
      if (entry.kind === "section" && entry.sectionId === sectionId) last = index;
    });
    lastIndex.set(sectionId, last);
  }
  const result: PreviewUpdateEntry[] = [];
  queue.forEach((entry, index) => {
    const replacement =
      entry.kind === "section" ? rebuilt.get(entry.sectionId) : undefined;
    if (!replacement) {
      result.push(entry);
    } else if (lastIndex.get(replacement.sectionId) === index) {
      result.push(replacement);
    }
  });
  // A commit that held no post of its own section still gets its section.
  for (const [sectionId, replacement] of rebuilt) {
    if (lastIndex.get(sectionId) === -1) result.push(replacement);
  }
  return result;
}

/**
 * E3 and M1: the posts a flush of `queue`, held under `tag`, sends now. None
 * once the tag is no longer the open edit's: the edit was ended by a ready or
 * a key change, or another edit was opened. Otherwise every held post made
 * for the page on screen, in order, less those whose own check fails now
 * (M3); each committed section rebuilt when `rebuildFrom` is given; merged by
 * M2 only when asked.
 */
export function flushDeferredQueue(
  state: DeferralState,
  tag: DeferralTag,
  queue: readonly PreviewUpdateEntry[],
  options: FlushOptions = {},
): PreviewUpdateEntry[] {
  if (!sameTag(state.open, tag)) return [];
  const inScope = options.inScope ?? (() => true);
  let posts = queue.filter((entry) => inScope(entry.scope) && sendable(entry));
  if (options.rebuildFrom) {
    const committed = state.committed
      .filter((section) => inScope(section.scope))
      .map((section) => section.sectionId);
    posts = rebuildCommittedSections(posts, committed, options.rebuildFrom);
  }
  return options.compact ? compactSectionUpdates(posts) : posts;
}

const NOTHING: DeferralOutput = { posts: [] };

/** Ends an open edit as lost and discards what it held (E1, E2). */
function loseEdit(state: DeferralState, next: Partial<DeferralState>) {
  const lost = state.open !== null;
  return {
    state: { ...state, ...next, open: null, queue: [], committed: [] },
    output: lost
      ? ({ posts: [], editEnded: { finished: false } } as DeferralOutput)
      : NOTHING,
  };
}

/** One event. No timers anywhere (E5): only these events move the state. */
export function stepDeferral(
  state: DeferralState,
  event: DeferralEvent,
  options: FlushOptions = {},
): { state: DeferralState; output: DeferralOutput } {
  switch (event.type) {
    case "editing": {
      if (event.editing) {
        // E4: an edit already open keeps its queue and its sequence.
        if (state.open) return { state, output: NOTHING };
        const editSeq = state.editSeq + 1;
        return {
          state: {
            ...state,
            editSeq,
            open: {
              previewKey: state.previewKey,
              readyRound: state.readyRound,
              editSeq,
            },
            queue: [],
            committed: [],
          },
          output: NOTHING,
        };
      }
      // E4: an end with no edit open is a no-op.
      if (!state.open) return { state, output: NOTHING };
      const posts = flushDeferredQueue(state, state.open, state.queue, options);
      return {
        state: { ...state, open: null, queue: [], committed: [] },
        output: { posts, editEnded: { finished: true } },
      };
    }
    case "ready": {
      // E1, E2: the document that came up has no edit open; the held posts
      // are discarded, not flushed.
      const lost = loseEdit(state, { readyRound: state.readyRound + 1 });
      if (state.open) {
        // Arming again replaces any replay still armed (`frameReloaded`
        // ends it), and the new one sends every section: no notice.
        return {
          state: { ...lost.state, replayArmed: true },
          output: { ...lost.output, armReplay: true },
        };
      }
      if (state.replayArmed) {
        // A new document replaced the one that replay was for: the content
        // is on neither, so it is armed again for this one.
        if (event.verified) {
          return { state: lost.state, output: { posts: [], armReplay: true } };
        }
        return {
          state: { ...lost.state, replayArmed: false },
          output: { posts: [], notice: "replay-unconfirmed" },
        };
      }
      return lost;
    }
    case "replay-settled":
      return state.replayArmed
        ? { state: { ...state, replayArmed: false }, output: NOTHING }
        : { state, output: NOTHING };
    case "key-change":
      if (event.previewKey === state.previewKey) {
        return { state, output: NOTHING };
      }
      // A replay armed for the old frame has nothing to bring to this one.
      return loseEdit(state, { previewKey: event.previewKey, replayArmed: false });
    case "lost":
      return loseEdit(state, {});
    case "post":
    case "commit": {
      const entry = event.type === "post" ? event.entry : event.echo;
      if (state.open) {
        return {
          state: {
            ...state,
            queue: entry ? [...state.queue, entry] : state.queue,
            committed:
              event.type === "commit"
                ? [
                    ...state.committed,
                    {
                      sectionId: event.sectionId,
                      ...(event.scope === undefined ? {} : { scope: event.scope }),
                    },
                  ]
                : state.committed,
          },
          output: NOTHING,
        };
      }
      if (!entry) return { state, output: NOTHING };
      return {
        state,
        output: { posts: sendable(entry) ? [entry] : [] },
      };
    }
  }
}
