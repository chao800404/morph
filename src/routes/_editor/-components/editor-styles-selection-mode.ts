import type { EditorAssistantPanelTab } from "./editor-assistant-panel";

type StylesSelectionTransition = {
  selectionMode: boolean;
  autoEnabled: boolean;
};

export function resolveStylesSelectionTransition({
  previousTab,
  nextTab,
  selectionMode,
  commentMode,
  autoEnabled,
}: {
  previousTab: EditorAssistantPanelTab;
  nextTab: EditorAssistantPanelTab;
  selectionMode: boolean;
  commentMode: boolean;
  autoEnabled: boolean;
}): StylesSelectionTransition {
  if (previousTab !== "styles" && nextTab === "styles" && !commentMode) {
    return {
      selectionMode: true,
      autoEnabled: !selectionMode,
    };
  }

  if (previousTab === "styles" && nextTab !== "styles") {
    return {
      selectionMode: autoEnabled ? false : selectionMode,
      autoEnabled: false,
    };
  }

  return { selectionMode, autoEnabled };
}
