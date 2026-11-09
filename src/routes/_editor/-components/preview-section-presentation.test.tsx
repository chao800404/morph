import { act, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { usePreviewDocument } from "../store/$storefrontId/themes/$themeId/preview";

const EDITOR_ORIGIN = "http://localhost:3000";
const PREVIEW_SESSION = "5f0f0f6e-6c2e-4f1c-9a3e-0f9a2b7c1d4e";
const token = {
  workspaceKey: "store-1:theme-1",
  templateId: "template-page",
  routePath: "/about",
  sectionId: "hero",
  documentBasis: { kind: "existing", draftGeneration: 3 },
  overlayRevision: 4,
  presentationRevision: 8,
  operationId: "presentation-8",
} as const;

let editor: Window;
let posted: Array<{ message: unknown; headingAtPost: string | null }>;

function Harness({ document }: { document: unknown }) {
  const preview = usePreviewDocument(document as never);
  const heading = preview?.sections[0]?.props?.heading;
  return <output data-testid="heading">{String(heading ?? "")}</output>;
}

function fromEditor(data: Record<string, unknown>) {
  act(() => {
    window.dispatchEvent(
      new MessageEvent("message", {
        data: { ...data, previewSession: PREVIEW_SESSION },
        origin: EDITOR_ORIGIN,
        source: editor,
      }),
    );
  });
}

beforeEach(() => {
  window.history.replaceState(
    null,
    "",
    `/preview?editorOrigin=${encodeURIComponent(EDITOR_ORIGIN)}&previewSession=${PREVIEW_SESSION}`,
  );
  const frame = document.createElement("iframe");
  document.body.appendChild(frame);
  editor = frame.contentWindow!;
  posted = [];
  vi.spyOn(editor, "postMessage").mockImplementation(((message: unknown) => {
    posted.push({
      message,
      headingAtPost:
        document.querySelector<HTMLOutputElement>("output")?.textContent ??
        null,
    });
  }) as never);
  Object.defineProperty(window, "parent", { value: editor, configurable: true });
});

afterEach(() => {
  Object.defineProperty(window, "parent", { value: window, configurable: true });
  vi.restoreAllMocks();
  document.body.innerHTML = "";
});

const initialDocument = {
  version: 1,
  sections: [{ id: "hero", enabled: true, props: { heading: "Before" } }],
};

describe("section presentation acknowledgements", () => {
  it("acknowledges an applied token after the committed document renders", () => {
    render(<Harness document={initialDocument} />);
    fromEditor({
      type: "morph:storefront-preview-update-section-props",
      sectionId: "hero",
      props: { heading: "After" },
      presentationToken: token,
    });

    expect(screen.getByTestId("heading").textContent).toBe("After");
    expect(posted).toEqual([
      {
        message: expect.objectContaining({
          type: "morph:storefront-preview-section-presentation-ack",
          operationId: token.operationId,
          token,
          status: "applied",
        }),
        headingAtPost: "After",
      },
    ]);
  });

  it("acknowledges a missing section as not applied after the React commit", () => {
    render(<Harness document={initialDocument} />);
    fromEditor({
      type: "morph:storefront-preview-update-section-props",
      sectionId: "missing",
      props: { heading: "After" },
      presentationToken: { ...token, sectionId: "missing", operationId: "missing-1" },
    });

    expect(posted[0]?.message).toMatchObject({
      type: "morph:storefront-preview-section-presentation-ack",
      operationId: "missing-1",
      status: "not-applied",
      reason: "section-missing",
    });
  });
});
