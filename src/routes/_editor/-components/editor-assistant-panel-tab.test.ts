import { beforeEach, describe, expect, it } from "vitest";
import {
  EDITOR_ASSISTANT_PANEL_TAB_STORAGE_KEY,
  persistEditorAssistantPanelTab,
  readStoredEditorAssistantPanelTab,
} from "./editor-assistant-panel";

describe("editor assistant panel tab persistence", () => {
  beforeEach(() => {
    window.localStorage.removeItem(EDITOR_ASSISTANT_PANEL_TAB_STORAGE_KEY);
  });

  it("reads a persisted inspector tab before the component renders", () => {
    window.localStorage.setItem(
      EDITOR_ASSISTANT_PANEL_TAB_STORAGE_KEY,
      "content",
    );

    expect(readStoredEditorAssistantPanelTab()).toBe("content");
  });

  it("falls back to Agent for missing or transient tabs", () => {
    expect(readStoredEditorAssistantPanelTab()).toBe("chat");

    window.localStorage.setItem(
      EDITOR_ASSISTANT_PANEL_TAB_STORAGE_KEY,
      "comments",
    );

    expect(readStoredEditorAssistantPanelTab()).toBe("chat");
  });

  it("persists normal tabs without storing the transient Comments mode", () => {
    persistEditorAssistantPanelTab("styles");
    expect(
      window.localStorage.getItem(EDITOR_ASSISTANT_PANEL_TAB_STORAGE_KEY),
    ).toBe("styles");

    persistEditorAssistantPanelTab("comments");
    expect(
      window.localStorage.getItem(EDITOR_ASSISTANT_PANEL_TAB_STORAGE_KEY),
    ).toBe("styles");
  });
});
