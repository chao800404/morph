import { useEffect, useRef } from "react";
import {
  didEditorContextChange,
  type EditorContextResetValues,
} from "@/lib/storefront/editor/editor-context-reset";

/**
 * Clears transient selection state when the editor moves to another route or
 * template. The shell owns what gets cleared; this hook owns when it happens,
 * so route and template changes cannot drift into two subtly different effects.
 */
export function useEditorContextReset(args: {
  templateId: string | undefined;
  routePath: string | undefined;
  onReset: () => void;
}): void {
  const { templateId, routePath, onReset } = args;
  const previousRef = useRef<EditorContextResetValues>({
    templateId,
    routePath,
  });

  useEffect(() => {
    const previous = previousRef.current;
    if (
      didEditorContextChange({
        previousTemplateId: previous.templateId,
        nextTemplateId: templateId,
        previousRoutePath: previous.routePath,
        nextRoutePath: routePath,
      })
    ) {
      onReset();
    }
    previousRef.current = { templateId, routePath };
  }, [onReset, routePath, templateId]);
}
