import { describe, expect, it, vi } from "vitest";
import type { VerifiedBuildPreviewCapability } from "./build-preview-capability";
import { serveBuildPreviewContent } from "./build-preview-content";

const capability: VerifiedBuildPreviewCapability = {
  id: "cap-1",
  storefrontId: "store-a",
  themeId: "theme-a",
  buildId: "build-ok",
  releaseId: null,
  userId: "admin-1",
  expiresAt: "2026-10-07T01:00:00.000Z",
  contentPublicationId: "pub-of-build",
};

function ports() {
  return {
    getPublishedDocument: vi.fn(async () => ({
      sections: [
        { id: "starter-hero", enabled: true, props: { heading: "Frozen" } },
      ],
    })),
  };
}

const serve = (url: string, contentPorts = ports(), method = "GET") =>
  serveBuildPreviewContent({
    request: new Request(url, { method }),
    capability,
    ports: contentPorts as never,
  });

describe("Build Preview content", () => {
  it("answers from the build's own content snapshot", async () => {
    const contentPorts = ports();
    const response = await serve(
      "http://bp.preview.test/_morph/content?path=/",
      contentPorts,
    );
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      slots: { "starter-hero": { heading: "Frozen" } },
      hiddenSlots: [],
    });
    expect(contentPorts.getPublishedDocument).toHaveBeenCalledWith({
      publicationId: "pub-of-build",
      templateType: "index",
    });
  });

  it("is private to the capability and never stored", async () => {
    const response = await serve(
      "http://bp.preview.test/_morph/content?path=/",
    );
    expect(response.headers.get("Cache-Control")).toBe("private, no-store");
  });

  it("refuses a path that could not be a route", async () => {
    const response = await serve(
      "http://bp.preview.test/_morph/content?path=notapath",
    );
    expect(response.status).toBe(400);
  });

  it("refuses a write", async () => {
    const response = await serve(
      "http://bp.preview.test/_morph/content?path=/",
      ports(),
      "POST",
    );
    expect(response.status).toBe(405);
  });
});
