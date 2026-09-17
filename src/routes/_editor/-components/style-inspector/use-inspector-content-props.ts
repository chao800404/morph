import { useEffect, useRef, useState } from "react";

export type InspectorContentProps = Record<string, unknown>;

/**
 * Compare stored content structurally.
 *
 * Refetched JSON objects are new references even when their contents did not
 * change. Structural comparison lets the hook rebase server updates without
 * mistaking every refetch for a local edit.
 */
export function sameInspectorContentValue(a: unknown, b: unknown): boolean {
  if (Object.is(a, b)) return true;
  if (a === null || b === null) return false;
  if (typeof a !== "object" || typeof b !== "object") return false;

  if (Array.isArray(a) !== Array.isArray(b)) return false;
  if (Array.isArray(a) && Array.isArray(b)) {
    return (
      a.length === b.length &&
      a.every((item, index) => sameInspectorContentValue(item, b[index]))
    );
  }

  const aRecord = a as Record<string, unknown>;
  const bRecord = b as Record<string, unknown>;
  const aKeys = Object.keys(aRecord);
  const bKeys = Object.keys(bRecord);
  if (aKeys.length !== bKeys.length) return false;
  return aKeys.every(
    (key) =>
      Object.prototype.hasOwnProperty.call(bRecord, key) &&
      sameInspectorContentValue(aRecord[key], bRecord[key]),
  );
}

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
    const local = localPropsRef.current;
    const rebased: InspectorContentProps = { ...incomingProps };
    for (const key of Object.keys(local)) {
      if (!sameInspectorContentValue(local[key], baseline[key])) {
        rebased[key] = local[key];
      }
    }

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
