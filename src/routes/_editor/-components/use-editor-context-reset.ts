import { useEffect, useRef } from "react";
import {
  didEditorContextChange,
  type EditorContextResetValues,
} from "@/lib/storefront/editor/editor-context-reset";

/**
 * Clears transient selection state when the editor moves to another route or
 * template. The shell owns what gets cleared; this hook owns when it happens,
 * so route and template changes cannot drift into two subtly different effects.
 *
 * `isSamePage` lets the shell name the one change of template that is not a
 * move: the editor taking up, on the same page, a route document it has just
 * created. That change resets nothing. Either way the values are recorded, so
 * the next change is judged from where the editor is now.
 */
export function useEditorContextReset(args: {
  templateId: string | undefined;
  routePath: string | undefined;
  onReset: () => void;
  isSamePage?: (
    previous: EditorContextResetValues,
    next: EditorContextResetValues,
  ) => boolean;
}): void {
  const { templateId, routePath, onReset, isSamePage } = args;
  const previousRef = useRef<EditorContextResetValues>({
    templateId,
    routePath,
  });
  // Read when a change is judged, so a new predicate does not re-run it.
  const isSamePageRef = useRef(isSamePage);
  isSamePageRef.current = isSamePage;

  useEffect(() => {
    const previous = previousRef.current;
    const next = { templateId, routePath };
    if (
      didEditorContextChange({
        previousTemplateId: previous.templateId,
        nextTemplateId: templateId,
        previousRoutePath: previous.routePath,
        nextRoutePath: routePath,
      }) &&
      !isSamePageRef.current?.(previous, next)
    ) {
      onReset();
    }
    previousRef.current = next;
  }, [onReset, routePath, templateId]);
}
