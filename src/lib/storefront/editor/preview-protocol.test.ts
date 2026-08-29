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
        type: "morph:storefront-preview-update-theme-files",
        files: [
          { path: "src/components/Hero.tsx", content: "export default 2" },
        ],
        styleRevision: 5,
        renderDocument: false,
      }),
    ).toEqual({
      type: "morph:storefront-preview-update-theme-files",
      files: [{ path: "src/components/Hero.tsx", content: "export default 2" }],
      styleRevision: 5,
      renderDocument: false,
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

  it("accepts a bounded editable structure and rejects ambiguous parent links", () => {
    const nodes = [
      {
        id: "hero:node:content",
        parentId: null,
        sectionId: "hero",
        label: "Content",
        kind: "container",
        tagName: "div",
        target: {
          sectionId: "hero",
          nodeId: "content",
          isSection: false,
        },
      },
      {
        id: "hero:node:heading",
        parentId: "hero:node:content",
        sectionId: "hero",
        label: "Heading",
        kind: "heading",
        tagName: "h1",
        target: {
          sectionId: "hero",
          nodeId: "heading",
          fieldPath: "heading",
          isSection: false,
        },
      },
    ] as const;

    expect(
      parseEditorToPreviewMessage({
        type: "morph:storefront-preview-request-structure",
      }),
    ).toEqual({ type: "morph:storefront-preview-request-structure" });
    expect(
      parsePreviewToEditorMessage({
        type: "morph:storefront-preview-structure",
        nodes,
      }),
    ).toEqual({ type: "morph:storefront-preview-structure", nodes });
    expect(
      parsePreviewToEditorMessage({
        type: "morph:storefront-preview-structure",
        nodes: [nodes[0], { ...nodes[1], parentId: "missing-parent" }],
      }),
    ).toBeNull();
    expect(
      parsePreviewToEditorMessage({
        type: "morph:storefront-preview-structure",
        nodes: [
          { ...nodes[0], parentId: nodes[1].id },
          { ...nodes[1], parentId: nodes[0].id },
        ],
      }),
    ).toBeNull();
    expect(
      parsePreviewToEditorMessage({
        type: "morph:storefront-preview-structure",
        nodes: [
          {
            ...nodes[0],
            target: { sectionId: "hero", isSection: true },
          },
        ],
      }),
    ).toBeNull();
    expect(
      parsePreviewToEditorMessage({
        type: "morph:storefront-preview-structure",
        nodes: Array.from({ length: 501 }, (_, index) => ({
          ...nodes[0],
          id: `node-${index}`,
        })),
      }),
    ).toBeNull();
    expect(
      parsePreviewToEditorMessage({
        type: "morph:storefront-preview-structure",
        nodes: [{ ...nodes[0], tagName: "DIV onclick=alert(1)" }],
      }),
    ).toBeNull();
  });

  it("accepts only supported spacing overlay modes", () => {
    expect(
      parseEditorToPreviewMessage({
        type: "morph:storefront-preview-set-spacing-overlay",
        mode: "selected",
      }),
    ).toEqual({
      type: "morph:storefront-preview-set-spacing-overlay",
      mode: "selected",
    });
    expect(
      parseEditorToPreviewMessage({
        type: "morph:storefront-preview-set-spacing-overlay",
        mode: "everything",
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
      contentValue: "Current heading",
      selectionRevision: 4,
      descendantFields: [{ fieldKey: "description", fieldPath: "description" }],
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
      contentValue: "Current heading",
      descendantFields: [{ fieldKey: "description", fieldPath: "description" }],
      selectionRevision: 4,
    });
    expect(
      parsePreviewToEditorMessage({
        ...selection,
        contentValue: "x".repeat(10_001),
      }),
    ).toBeNull();
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
    expect(
      parsePreviewToEditorMessage({
        ...selection,
        descendantFields: [{ fieldKey: "heading", fieldPath: 12 }],
      }),
    ).toBeNull();
    expect(
      parsePreviewToEditorMessage({
        ...selection,
        descendantFields: Array.from({ length: 101 }, (_, index) => ({
          fieldKey: `field-${index}`,
          fieldPath: `field-${index}`,
        })),
      }),
    ).toBeNull();
    expect(
      parsePreviewToEditorMessage({ ...selection, selectionRevision: -1 }),
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

  it("accepts only a bounded inline text commit", () => {
    const message = {
      type: "morph:storefront-preview-commit-inline-text",
      sectionId: "hero",
      fieldKey: "heading",
      fieldPath: "content.heading",
      value: "Edited in the canvas",
    };

    expect(parsePreviewToEditorMessage(message)).toEqual(message);
    expect(
      parsePreviewToEditorMessage({ ...message, sectionId: "x".repeat(101) }),
    ).toBeNull();
    expect(
      parsePreviewToEditorMessage({ ...message, fieldKey: "x".repeat(201) }),
    ).toBeNull();
    expect(
      parsePreviewToEditorMessage({ ...message, fieldPath: "x".repeat(501) }),
    ).toBeNull();
    expect(
      parsePreviewToEditorMessage({ ...message, value: "x".repeat(10_001) }),
    ).toBeNull();
    expect(
      parsePreviewToEditorMessage({ ...message, value: { html: "<b>x</b>" } }),
    ).toBeNull();
    expect(
      parsePreviewToEditorMessage({ ...message, fieldPath: "" }),
    ).toBeNull();
  });

  it("accepts a drag autoscroll report only with a usable pointer", () => {
    const message = {
      type: "morph:storefront-preview-drag-autoscroll",
      phase: "move",
      clientX: 320,
      clientY: 940,
    };

    expect(parsePreviewToEditorMessage(message)).toEqual(message);
    expect(
      parsePreviewToEditorMessage({ ...message, phase: "end" }),
    ).toMatchObject({ phase: "end" });
    // A pointer that is not a finite number would drive the scroll loop off
    // the canvas rather than towards it.
    expect(
      parsePreviewToEditorMessage({ ...message, clientY: Number.NaN }),
    ).toBeNull();
    expect(
      parsePreviewToEditorMessage({ ...message, clientX: "320" }),
    ).toBeNull();
    expect(
      parsePreviewToEditorMessage({ ...message, phase: "start" }),
    ).toBeNull();
  });

  it("accepts only bounded, distinct section reorder identities", () => {
    const message = {
      type: "morph:storefront-preview-commit-section-reorder",
      draggedSectionId: "starter-hero",
      targetSectionId: "promo",
    };

    expect(parsePreviewToEditorMessage(message)).toEqual(message);
    // Dropping a section on itself is not a reorder, and an unbounded identity
    // is not one this editor authored.
    expect(
      parsePreviewToEditorMessage({
        ...message,
        targetSectionId: message.draggedSectionId,
      }),
    ).toBeNull();
    expect(
      parsePreviewToEditorMessage({
        ...message,
        draggedSectionId: "x".repeat(101),
      }),
    ).toBeNull();
    expect(
      parsePreviewToEditorMessage({ ...message, targetSectionId: 7 }),
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

describe("live style preview carries the source position", () => {
  it("accepts and forwards a source position with the style update", () => {
    // An unmarked element's targetElement is only "line:column", which matches
    // no DOM attribute; without the full position the preview cannot find the
    // element and a dragged control shows no live feedback.
    const parsed = parseEditorToPreviewMessage({
      type: "morph:storefront-preview-update-selection-style",
      styles: { color: "red" },
      targetElement: "10:7",
      sourceLocation: "src/components/Promo.tsx:10:7",
    });

    expect(parsed).toMatchObject({
      targetElement: "10:7",
      sourceLocation: "src/components/Promo.tsx:10:7",
    });
  });

  it("still accepts a message with no source position", () => {
    const parsed = parseEditorToPreviewMessage({
      type: "morph:storefront-preview-update-selection-style",
      styles: { color: "red" },
      targetElement: "hero-heading",
    });
    expect(parsed).toMatchObject({
      targetElement: "hero-heading",
      sourceLocation: null,
    });
  });

  it("refuses an oversized source position", () => {
    expect(
      parseEditorToPreviewMessage({
        type: "morph:storefront-preview-update-selection-style",
        styles: { color: "red" },
        targetElement: "10:7",
        sourceLocation: "a".repeat(401),
      }),
    ).toBeNull();
  });
});

describe("structure nodes identified only by source position", () => {
  const node = (overrides: Record<string, unknown> = {}) => ({
    id: "src/components/Header.tsx:loc:src/components/Header.tsx:11:7",
    parentId: null,
    sectionId: "src/components/Header.tsx",
    label: "Nav",
    kind: "navigation",
    tagName: "nav",
    target: {
      sectionId: "src/components/Header.tsx",
      sourceLocation: "src/components/Header.tsx:11:7",
      isSection: false,
    },
    ...overrides,
  });

  it("accepts a node whose only identity is where it came from in source", () => {
    // A component with no authored markers produces exactly this. Rejecting it
    // failed the whole message — one marker-free element made the entire
    // structure unusable, and the panel silently kept the last one it had
    // accepted, so the tree showed a Theme that no longer existed.
    const parsed = parsePreviewToEditorMessage({
      type: "morph:storefront-preview-structure",
      nodes: [node()],
    });

    expect(parsed).not.toBeNull();
    expect((parsed as any).nodes).toHaveLength(1);
  });

  it("carries the source position through to the restore target", () => {
    // Accepting it but dropping it would leave the element with nothing to
    // restore its selection by after a re-render.
    const parsed: any = parsePreviewToEditorMessage({
      type: "morph:storefront-preview-structure",
      nodes: [node()],
    });

    expect(parsed.nodes[0].target.sourceLocation).toBe(
      "src/components/Header.tsx:11:7",
    );
  });

  it("still rejects a node that identifies nothing at all", () => {
    const parsed = parsePreviewToEditorMessage({
      type: "morph:storefront-preview-structure",
      nodes: [
        node({
          target: { sectionId: "src/components/Header.tsx", isSection: false },
        }),
      ],
    });

    expect(parsed).toBeNull();
  });

  it("rejects an implausibly long source position", () => {
    const parsed = parsePreviewToEditorMessage({
      type: "morph:storefront-preview-structure",
      nodes: [
        node({
          target: {
            sectionId: "src/components/Header.tsx",
            sourceLocation: "x".repeat(501),
            isSection: false,
          },
        }),
      ],
    });

    expect(parsed).toBeNull();
  });
});

describe("stable identity on a structure node", () => {
  const withIdentity = (stableId?: unknown) => ({
    type: "morph:storefront-preview-structure",
    nodes: [
      {
        id: "hero:node:hero-heading",
        parentId: null,
        sectionId: "hero",
        label: "Heading",
        kind: "heading",
        tagName: "h1",
        ...(stableId === undefined ? {} : { stableId }),
        target: { sectionId: "hero", nodeId: "hero-heading", isSection: false },
      },
    ],
  });

  it("carries the identity through so the panel can mark it", () => {
    // Only an element with an identity that survives edits can carry a style
    // bound to one instance, so which elements have one is worth showing.
    const parsed: any = parsePreviewToEditorMessage(
      withIdentity("hero-heading"),
    );

    expect(parsed.nodes[0].stableId).toBe("hero-heading");
  });

  it("accepts a node with no identity at all", () => {
    const parsed: any = parsePreviewToEditorMessage(withIdentity());

    expect(parsed).not.toBeNull();
    expect(parsed.nodes[0].stableId).toBeUndefined();
  });

  it("rejects an identity that is not a bounded string", () => {
    expect(parsePreviewToEditorMessage(withIdentity(42))).toBeNull();
    expect(
      parsePreviewToEditorMessage(withIdentity("x".repeat(201))),
    ).toBeNull();
  });
});
