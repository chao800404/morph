import { useEffect, useMemo, useRef, useState } from "react";
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
} {
  const { resourceKey, sectionId, sectionProps } = args;
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
  const [localProps, setLocalProps] =
    useState<InspectorContentProps>(incomingProps);
  const localPropsRef = useRef(localProps);
  const serverBaselineRef = useRef<InspectorContentProps>(incomingProps);
  const contentResourceKey = `${resourceKey}:${sectionId}`;
  const lastContentResourceKeyRef = useRef(contentResourceKey);
  const [externalEpochs, setExternalEpochs] = useState<
    Readonly<Record<string, number>>
  >({});

  useEffect(() => {
    const baseline = serverBaselineRef.current;
    serverBaselineRef.current = incomingProps;

    // Switching sections replaces everything; there is no edit in progress
    // that belongs to the new one.
    if (contentResourceKey !== lastContentResourceKeyRef.current) {
      lastContentResourceKeyRef.current = contentResourceKey;
      localPropsRef.current = incomingProps;
      setLocalProps(incomingProps);
      return;
    }

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

    localPropsRef.current = rebased;
    setLocalProps(rebased);
    if (adopted.length > 0) {
      setExternalEpochs((current) => {
        const next = { ...current };
        for (const key of adopted) next[key] = (next[key] ?? 0) + 1;
        return next;
      });
    }
  }, [contentResourceKey, incomingProps]);

  const props =
    contentResourceKey === lastContentResourceKeyRef.current
      ? localProps
      : incomingProps;

  return {
    contentResourceKey,
    localProps,
    setLocalProps,
    localPropsRef,
    props,
    externalEpochs,
  };
}
