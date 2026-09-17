import { useEffect, useRef, useState } from "react";
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
} {
  const { resourceKey, sectionId, sectionProps } = args;
  const incomingProps =
    sectionProps &&
    typeof sectionProps === "object" &&
    !Array.isArray(sectionProps)
      ? (sectionProps as InspectorContentProps)
      : {};
  const [localProps, setLocalProps] =
    useState<InspectorContentProps>(incomingProps);
  const localPropsRef = useRef(localProps);
  const serverBaselineRef = useRef<InspectorContentProps>(incomingProps);
  const contentResourceKey = `${resourceKey}:${sectionId}`;
  const lastContentResourceKeyRef = useRef(contentResourceKey);

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
    const rebased = rebaseContentProps({
      incoming: incomingProps,
      baseline,
      local: localPropsRef.current,
    });

    localPropsRef.current = rebased;
    setLocalProps(rebased);
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
  };
}
