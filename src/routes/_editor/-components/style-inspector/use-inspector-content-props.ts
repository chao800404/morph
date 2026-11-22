import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  rebaseContentProps,
  sameContentValue,
} from "@/lib/storefront/editor/content-rebase";

export type InspectorContentProps = Record<string, unknown>;

/**
 * Compare stored content structurally.
 *
 * The rule now lives in `content-rebase`, where the content write path can
 * reach it too: a conflicted save has to rebase the same way a refetch does.
 * Re-exported for the callers that already know it by this name.
 */
export const sameInspectorContentValue = sameContentValue;

/**
 * Keeps Inspector content edits responsive while rebasing server updates.
 *
 * A section switch replaces the local snapshot. For the same section, keys
 * changed locally stay in place and all other keys adopt the latest server
 * value. This is the same rule used by the old inline state block, now isolated
 * so it can be verified without rendering the full Inspector orchestrator.
 */
export function useInspectorContentProps(args: {
  resourceKey: string;
  sectionId: string;
  sectionProps: unknown;
  /**
   * The input the editor still holds for this section of this document and
   * has not saved (its pending entry's props), read when the panel starts
   * showing the section: on mount and on a switch of section or document.
   * Shown over the stored props, key by key, so a field opened again shows
   * the kept draft the canvas shows, and every other field its own value.
   * The stored props stay the baseline; nothing is written from here.
   */
  heldProps?: () => InspectorContentProps | undefined;
  /**
   * This section's stored props in the newest copy the editor has accepted
   * of its document, read when the panel opens the section with held input
   * on top. See `noteLocalInput`: the held keys were made on that copy, not
   * on the older one the panel may be opened from.
   */
  acceptedProps?: () => InspectorContentProps | undefined;
}): {
  contentResourceKey: string;
  localProps: InspectorContentProps;
  setLocalProps: React.Dispatch<React.SetStateAction<InspectorContentProps>>;
  localPropsRef: React.MutableRefObject<InspectorContentProps>;
  props: InspectorContentProps;
  /**
   * Per top-level key, how many times its shown value was replaced by a
   * newer server value the author had not changed locally. An input holds
   * its own value, so this is what tells it the stored value moved under it.
   * Keys the author changed are kept as they are and never counted.
   */
  externalEpochs: Readonly<Record<string, number>>;
  /**
   * The author changed top-level `key`, on `accepted`: the newest copy of
   * the section the editor has accepted, when the shell names one.
   *
   * The baseline a later server copy is rebased against is otherwise the
   * last copy this hook was handed. A write answered but not yet rendered is
   * newer than that one; an input made on it (typing the earlier value back,
   * say) would look unchanged against the older baseline, and the rendered
   * answer would replace it. So the changed key's baseline moves up to the
   * accepted copy's value. Only that key, and never past what was accepted.
   */
  noteLocalInput: (
    key: string,
    accepted: InspectorContentProps | undefined,
  ) => void;
  /**
   * Shows the accepted value of top-level `key` in place of the panel's own
   * (`undefined`: the key is not stored), as unchanged by the author: it is
   * the value and the baseline both, and the key's inputs remount to show
   * it. For a list the panel showed behind the accepted copy, after the list
   * action on it was refused. Every other key is left as it is.
   */
  adoptAcceptedValue: (key: string, accepted: unknown) => void;
} {
  const { resourceKey, sectionId, sectionProps } = args;
  const heldPropsRef = useRef(args.heldProps);
  heldPropsRef.current = args.heldProps;
  const acceptedPropsRef = useRef(args.acceptedProps);
  acceptedPropsRef.current = args.acceptedProps;
  /** The stored props with the held input on top, as the panel opens them. */
  const withHeld = (incoming: InspectorContentProps): InspectorContentProps => {
    const held = heldPropsRef.current?.();
    return held && Object.keys(held).length > 0
      ? { ...incoming, ...held }
      : incoming;
  };
  /**
   * The baseline the panel opens with: the stored props it was handed, with
   * each held key's baseline moved up to the accepted copy, as
   * `noteLocalInput` moves a key the author changes here.
   *
   * The held input was staged on the accepted copy, which can be newer than
   * the copy the panel opens from: a write answered but not yet rendered.
   * Against the older copy, a held value equal to it (the earlier value
   * typed back) looks unchanged, and the rendered answer would replace it
   * here while the editor still holds it. Only held keys move; with no
   * accepted copy named, the baseline stays the stored props.
   */
  const openedBaseline = (
    incoming: InspectorContentProps,
  ): InspectorContentProps => {
    const held = heldPropsRef.current?.();
    if (!held || Object.keys(held).length === 0) return incoming;
    const accepted = acceptedPropsRef.current?.();
    if (!accepted) return incoming;
    const baseline = { ...incoming };
    for (const key of Object.keys(held)) {
      if (Object.hasOwn(accepted, key)) baseline[key] = accepted[key];
      else delete baseline[key];
    }
    return baseline;
  };
  // Kept by identity across renders. The rebase effect below depends on it and
  // sets state, so a fresh `{}` per render for a section without props made
  // every render schedule the next one, until React stopped it with "Maximum
  // update depth exceeded" and tore the editor down.
  const incomingProps = useMemo(
    () =>
      sectionProps &&
      typeof sectionProps === "object" &&
      !Array.isArray(sectionProps)
        ? (sectionProps as InspectorContentProps)
        : {},
    [sectionProps],
  );
  const [localProps, setLocalProps] = useState<InspectorContentProps>(() =>
    withHeld(incomingProps),
  );
  const localPropsRef = useRef(localProps);
  const serverBaselineRef = useRef<InspectorContentProps | null>(null);
  if (serverBaselineRef.current === null) {
    serverBaselineRef.current = openedBaseline(incomingProps);
  }
  /** The stored props the effect below last rebased onto. */
  const lastIncomingRef = useRef(incomingProps);
  const contentResourceKey = `${resourceKey}:${sectionId}`;
  const lastContentResourceKeyRef = useRef(contentResourceKey);
  const [externalEpochs, setExternalEpochs] = useState<
    Readonly<Record<string, number>>
  >({});

  useEffect(() => {
    // Switching sections replaces everything; there is no edit in progress
    // in this panel that belongs to the new one. What the editor still holds
    // for it is shown, as on mount, on the same baseline as on mount.
    if (contentResourceKey !== lastContentResourceKeyRef.current) {
      lastContentResourceKeyRef.current = contentResourceKey;
      lastIncomingRef.current = incomingProps;
      serverBaselineRef.current = openedBaseline(incomingProps);
      const opened = withHeld(incomingProps);
      localPropsRef.current = opened;
      setLocalProps(opened);
      return;
    }
    // The props the panel opened with, or last rebased onto: nothing newer
    // to rebase onto. (The run after mount, chiefly: the baseline the panel
    // opened with stays until a newer copy arrives.)
    if (incomingProps === lastIncomingRef.current) return;
    lastIncomingRef.current = incomingProps;
    const baseline = serverBaselineRef.current ?? incomingProps;
    serverBaselineRef.current = incomingProps;

    // Keep keys the author is currently editing while rebasing every other
    // key onto the latest server state.
    const local = localPropsRef.current;
    const rebased = rebaseContentProps({
      incoming: incomingProps,
      baseline,
      local,
    });
    // A key whose shown value changed here took the server's: the author had
    // not changed it (a key they changed is kept, so it cannot differ).
    const adopted = Object.keys({ ...local, ...rebased }).filter(
      (key) => !sameContentValue(rebased[key], local[key]),
    );
    // Nothing shown changes: keep the props the panel holds. A new object
    // here would cost one more render after every parent render that hands
    // over equal props under a new identity (a code component's stand-in
    // section, rebuilt on each render of the panel).
    if (adopted.length === 0) return;

    localPropsRef.current = rebased;
    setLocalProps(rebased);
    setExternalEpochs((current) => {
      const next = { ...current };
      for (const key of adopted) next[key] = (next[key] ?? 0) + 1;
      return next;
    });
  }, [contentResourceKey, incomingProps]);

  const noteLocalInput = useCallback(
    (key: string, accepted: InspectorContentProps | undefined) => {
      if (!accepted) return;
      const baseline = { ...serverBaselineRef.current };
      if (Object.hasOwn(accepted, key)) baseline[key] = accepted[key];
      else delete baseline[key];
      serverBaselineRef.current = baseline;
    },
    [],
  );

  const adoptAcceptedValue = useCallback((key: string, accepted: unknown) => {
    const local = { ...localPropsRef.current };
    const baseline = { ...serverBaselineRef.current };
    if (accepted === undefined) {
      delete local[key];
      delete baseline[key];
    } else {
      local[key] = accepted;
      baseline[key] = accepted;
    }
    serverBaselineRef.current = baseline;
    localPropsRef.current = local;
    setLocalProps(local);
    setExternalEpochs((current) => ({
      ...current,
      [key]: (current[key] ?? 0) + 1,
    }));
  }, []);

  const props =
    contentResourceKey === lastContentResourceKeyRef.current
      ? localProps
      : withHeld(incomingProps);

  return {
    contentResourceKey,
    localProps,
    setLocalProps,
    localPropsRef,
    props,
    externalEpochs,
    noteLocalInput,
    adoptAcceptedValue,
  };
}
