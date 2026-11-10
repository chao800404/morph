import { act, cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { StorefrontPageDocument } from "@/db/storefront.schema";
import { usePreviewDocument } from "./use-preview-document";

const protocol = vi.hoisted(() => ({
  parse: vi.fn(),
  post: vi.fn(),
}));

vi.mock("./preview-protocol", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./preview-protocol")>()),
  parseEditorToPreviewWindowEvent: protocol.parse,
  postPreviewToEditorMessage: protocol.post,
}));

const initialDocument = {
  version: 1,
  sections: [
    {
      id: "hero",
      type: "hero",
      enabled: true,
      props: { heading: "Before" },
    },
  ],
} as StorefrontPageDocument;

const presentationToken = {
  workspaceKey: "store-1:theme-1",
  templateId: "page-template-1",
  routePath: "/about",
  sectionId: "hero",
  documentBasis: { kind: "existing", draftGeneration: 3 },
  overlayRevision: 1,
  presentationRevision: 9,
  operationId: "section-presentation-9",
} as const;

function PreviewDocument({
  document,
}: {
  document: StorefrontPageDocument;
}) {
  const preview = usePreviewDocument(document);
  return (
    <output data-testid="rendered-heading">
      {String(preview?.sections[0]?.props?.heading ?? "")}
    </output>
  );
}

describe("preview document presentation acknowledgement", () => {
  let headingAtAck: string | null;

  beforeEach(() => {
    headingAtAck = null;
    protocol.parse.mockImplementation((event: MessageEvent) => event.data);
    protocol.post.mockImplementation((message: { type?: string }) => {
      if (message.type === "morph:storefront-preview-section-presentation-ack") {
        headingAtAck =
          screen.getByTestId("rendered-heading").textContent ?? null;
      }
    });
  });

  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it("acknowledges an applied token after the updated DOM has committed", async () => {
    render(<PreviewDocument document={initialDocument} />);

    await act(async () => {
      window.dispatchEvent(
        new MessageEvent("message", {
          data: {
            type: "morph:storefront-preview-update-section-props",
            sectionId: "hero",
            props: { heading: "After" },
            presentationToken,
          },
        }),
      );
    });

    expect(screen.getByTestId("rendered-heading").textContent).toBe("After");
    expect(headingAtAck).toBe("After");
    expect(protocol.post).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "morph:storefront-preview-section-presentation-ack",
        operationId: presentationToken.operationId,
        token: presentationToken,
        status: "applied",
      }),
    );
  });

  it("reports a missing section as not applied", async () => {
    render(<PreviewDocument document={initialDocument} />);

    await act(async () => {
      window.dispatchEvent(
        new MessageEvent("message", {
          data: {
            type: "morph:storefront-preview-update-section-props",
            sectionId: "missing",
            props: { heading: "Never rendered" },
            presentationToken: {
              ...presentationToken,
              sectionId: "missing",
              presentationRevision: 10,
              operationId: "section-presentation-10",
            },
          },
        }),
      );
    });

    expect(screen.getByTestId("rendered-heading").textContent).toBe("Before");
    expect(protocol.post).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "morph:storefront-preview-section-presentation-ack",
        operationId: "section-presentation-10",
        status: "not-applied",
        reason: "section-missing",
      }),
    );
  });

  it("does not report an applied token when a newer section update supersedes it before commit", async () => {
    render(<PreviewDocument document={initialDocument} />);
    const newerToken = {
      ...presentationToken,
      presentationRevision: 10,
      operationId: "section-presentation-10",
    };

    await act(async () => {
      window.dispatchEvent(
        new MessageEvent("message", {
          data: {
            type: "morph:storefront-preview-update-section-props",
            sectionId: "hero",
            props: { heading: "Superseded" },
            presentationToken,
          },
        }),
      );
      window.dispatchEvent(
        new MessageEvent("message", {
          data: {
            type: "morph:storefront-preview-update-section-props",
            sectionId: "hero",
            props: { heading: "Latest" },
            presentationToken: newerToken,
          },
        }),
      );
    });

    expect(screen.getByTestId("rendered-heading").textContent).toBe("Latest");
    expect(protocol.post.mock.calls).toHaveLength(2);
    expect(protocol.post.mock.calls[0]?.[0]).toEqual(
      expect.objectContaining({
        operationId: presentationToken.operationId,
        status: "not-applied",
        reason: "superseded",
      }),
    );
    expect(protocol.post.mock.calls[1]?.[0]).toEqual(
      expect.objectContaining({
        operationId: newerToken.operationId,
        status: "applied",
      }),
    );
    expect(headingAtAck).toBe("Latest");
  });
});
