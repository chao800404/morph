import { describe, expect, it, vi } from "vitest";
import {
  parseEditorToPreviewEvent,
  parseEditorToPreviewMessage,
  parsePreviewToEditorEvent,
  parsePreviewToEditorMessage,
  postEditorToPreviewMessage,
  type PreviewStyleSnapshot,
} from "./preview-protocol";

const styleSnapshot: PreviewStyleSnapshot = {
  fontSize: "48px",
  lineHeight: "1",
  fontFamily: "sans-serif",
  fontWeight: "700",
  textAlign: "center",
  paddingTop: "0px",
  paddingBottom: "0px",
  paddingLeft: "0px",
  paddingRight: "0px",
  marginTop: "24px",
  marginBottom: "0px",
  marginLeft: "0px",
  marginRight: "0px",
  color: "rgb(28, 25, 23)",
  backgroundColor: "rgba(0, 0, 0, 0)",
  backgroundImage: "none",
  borderRadius: "0px",
  borderTopLeftRadius: "0px",
  borderTopRightRadius: "0px",
  borderBottomRightRadius: "0px",
  borderBottomLeftRadius: "0px",
  borderTopWidth: "0px",
  borderTopStyle: "none",
  borderTopColor: "rgb(28, 25, 23)",
  display: "block",
  flexDirection: "row",
  gap: "normal",
  width: "100px",
  height: "50px",
  minWidth: "0px",
  maxWidth: "none",
  minHeight: "0px",
  maxHeight: "none",
  boxSizing: "border-box",
  position: "static",
  top: "auto",
  left: "auto",
  zIndex: "auto",
  opacity: "1",
  overflow: "visible",
  transform: "none",
  alignItems: "normal",
  justifyContent: "normal",
};

describe("preview protocol", () => {
  it("accepts a bounded theme workspace update", () => {
    expect(
      parseEditorToPreviewMessage({
        type: "morph:storefront-preview-update-theme-files",
        files: [
          { path: "src/components/Hero.tsx", content: "export default 1" },
        ],
        styleRevision: 4,
        sourceGeneration: 2,
      }),
    ).toEqual({
      type: "morph:storefront-preview-update-theme-files",
      files: [{ path: "src/components/Hero.tsx", content: "export default 1" }],
      styleRevision: 4,
      sourceGeneration: 2,
    });
    expect(
      parseEditorToPreviewMessage({
        type: "morph:storefront-preview-reset-selection-style-preview",
      }),
    ).toEqual({
      type: "morph:storefront-preview-reset-selection-style-preview",
    });
  });

  it("accepts bounded selection restore targets and rejects malformed ones", () => {
    const message = {
      type: "morph:storefront-preview-set-selection-mode",
      enabled: true,
      restoreTarget: {
        sectionId: "hero",
        nodeId: "hero-heading",
        fieldPath: "items.0.heading",
        elementKey: "heading",
        fieldKey: "heading",
        isSection: false,
      },
    };
    expect(parseEditorToPreviewMessage(message)).toEqual(message);
    expect(
      parseEditorToPreviewMessage({
        ...message,
        restoreTarget: { sectionId: "hero", nodeId: "x".repeat(201) },
      }),
    ).toBeNull();
    expect(
      parseEditorToPreviewMessage({
        ...message,
        restoreTarget: { sectionId: "hero" },
      }),
    ).toBeNull();
  });

  it("rejects malformed or unbounded editor messages", () => {
    expect(
      parseEditorToPreviewMessage({
        type: "morph:storefront-preview-update-theme-files",
        files: [{ path: 12, content: "invalid" }],
        styleRevision: 1,
      }),
    ).toBeNull();
    expect(
      parseEditorToPreviewMessage({
        type: "morph:storefront-preview-update-selection-field",
        fieldKey: "heading",
        fieldPath: null,
        value: "x".repeat(10_001),
      }),
    ).toBeNull();
  });

  it("narrows a selection response and rejects invalid style payloads", () => {
    const selection = {
      type: "morph:storefront-preview-select-section",
      sectionId: "hero",
      componentType: "heading",
      kind: "text",
      sourceFilePath: "src/components/Hero.tsx",
      elementKey: "heading",
      fieldKey: "heading",
      field: "heading",
      fieldPath: "heading",
      tagName: "h1",
      role: null,
      inputType: null,
      styleRevision: 3,
      className: "text-4xl",
      isSection: false,
      inspectorOverride: null,
      computedStyle: styleSnapshot,
      parentComputedStyle: null,
      sectionComputedStyle: null,
    };
    expect(parsePreviewToEditorMessage(selection)).toMatchObject({
      kind: "text",
      styleRevision: 3,
    });
    expect(
      parsePreviewToEditorMessage({
        ...selection,
        computedStyle: { ...styleSnapshot, fontSize: 48 },
      }),
    ).toBeNull();
    expect(
      parsePreviewToEditorMessage({
        ...selection,
        computedStyle: { ...styleSnapshot, marginTop: undefined },
      }),
    ).toBeNull();
  });

  it("accepts only bounded, distinct sibling reorder identities", () => {
    const message = {
      type: "morph:storefront-preview-commit-sibling-reorder",
      sectionId: "hero",
      sourceFilePath: "src/components/Hero.tsx",
      draggedNodeId: "hero-heading",
      targetNodeId: "hero-copy",
    };

    expect(parsePreviewToEditorMessage(message)).toEqual(message);
    expect(
      parsePreviewToEditorMessage({
        ...message,
        targetNodeId: message.draggedNodeId,
      }),
    ).toBeNull();
    expect(
      parsePreviewToEditorMessage({
        ...message,
        sourceFilePath: "x".repeat(1_001),
      }),
    ).toBeNull();
  });

  it("accepts only bounded, distinct array item reorder paths", () => {
    const message = {
      type: "morph:storefront-preview-commit-array-item-reorder",
      sectionId: "principles",
      draggedFieldPath: "items.0",
      targetFieldPath: "items.2",
    };

    expect(parsePreviewToEditorMessage(message)).toEqual(message);
    expect(
      parsePreviewToEditorMessage({
        ...message,
        targetFieldPath: message.draggedFieldPath,
      }),
    ).toBeNull();
    expect(
      parsePreviewToEditorMessage({
        ...message,
        targetFieldPath: "x".repeat(501),
      }),
    ).toBeNull();
  });

  it("accepts a bounded selection field path restoration", () => {
    const message = {
      type: "morph:storefront-preview-set-selection-field-path",
      sectionId: "principles",
      fieldPath: "items.0",
    };

    expect(parseEditorToPreviewMessage(message)).toEqual(message);
    expect(
      parseEditorToPreviewMessage({
        ...message,
        fieldPath: "x".repeat(501),
      }),
    ).toBeNull();
  });

  it("accepts JSON section props and rejects non-serializable values", () => {
    expect(
      parseEditorToPreviewMessage({
        type: "morph:storefront-preview-update-section-props",
        sectionId: "hero",
        props: { heading: "Hello", nested: { enabled: true } },
      }),
    ).toMatchObject({ sectionId: "hero" });
    expect(
      parseEditorToPreviewMessage({
        type: "morph:storefront-preview-update-section-props",
        sectionId: "hero",
        props: { invalid: Number.NaN },
      }),
    ).toBeNull();
  });

  it("requires the exact origin, source, and preview session", () => {
    const source = {} as Window;
    const data = {
      type: "morph:storefront-preview-request-size",
      previewSession: "11111111-1111-4111-8111-111111111111",
    };
    const event = {
      origin: "https://preview.example.net",
      source,
      data,
    } as MessageEvent<unknown>;
    const security = {
      expectedOrigin: "https://preview.example.net",
      expectedSource: source,
      previewSession: "11111111-1111-4111-8111-111111111111",
    };

    expect(parseEditorToPreviewEvent(event, security)).toEqual({
      type: "morph:storefront-preview-request-size",
    });
    expect(
      parseEditorToPreviewEvent(event, {
        ...security,
        expectedOrigin: "https://attacker.example",
      }),
    ).toBeNull();
    expect(
      parseEditorToPreviewEvent(event, {
        ...security,
        expectedSource: {} as Window,
      }),
    ).toBeNull();
    expect(
      parseEditorToPreviewEvent(event, {
        ...security,
        previewSession: "22222222-2222-4222-8222-222222222222",
      }),
    ).toBeNull();
    expect(
      parseEditorToPreviewEvent(
        { ...event, data: { type: data.type } } as MessageEvent<unknown>,
        security,
      ),
    ).toBeNull();

    expect(
      parsePreviewToEditorEvent(
        {
          ...event,
          data: {
            type: "morph:storefront-preview-ready",
            previewSession: data.previewSession,
          },
        } as MessageEvent<unknown>,
        security,
      ),
    ).toEqual({ type: "morph:storefront-preview-ready" });
  });

  it("posts a session-bound message only to the configured origin", () => {
    const postMessage = vi.fn();
    postEditorToPreviewMessage(
      { postMessage } as unknown as Window,
      { type: "morph:storefront-preview-request-size" },
      {
        targetOrigin: "https://preview.example.net",
        previewSession: "11111111-1111-4111-8111-111111111111",
      },
    );
    expect(postMessage).toHaveBeenCalledWith(
      {
        type: "morph:storefront-preview-request-size",
        previewSession: "11111111-1111-4111-8111-111111111111",
      },
      "https://preview.example.net",
    );

    postMessage.mockClear();
    postEditorToPreviewMessage(
      { postMessage } as unknown as Window,
      { type: "morph:storefront-preview-request-size" },
      {
        targetOrigin: "*",
        previewSession: "11111111-1111-4111-8111-111111111111",
      },
    );
    expect(postMessage).not.toHaveBeenCalled();
  });
});
