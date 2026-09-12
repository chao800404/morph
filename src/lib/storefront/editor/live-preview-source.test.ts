// @vitest-environment node
import { describe, expect, it } from "vitest";
import {
  resolveLivePreviewSource,
  withPreviewChannel,
} from "./live-preview-source";

const BASE = {
  editorOrigin: "https://admin.example.com",
  previewSession: "3f2504e0-4f89-41d3-9a0c-0305e82c3301",
  compatibilityOrigin: "https://admin.example.com",
  storefrontId: "storefront-1",
  themeId: "theme-1",
  templateId: "template-1",
  viewportHeight: 900,
} as const;

const SERVER_URL = "https://5173-sbx1-tok.preview.example.com/";

describe("choosing which preview the editor frames", () => {
  it("frames the compatibility preview until a deployment opts in", () => {
    // Running a Theme's own JavaScript is something a deployment asks for,
    // never something that happens because a setting was missing.
    const source = resolveLivePreviewSource({
      ...BASE,
      executionMode: "compatibility-renderer",
      previewServerUrl: SERVER_URL,
    });
    expect(source.kind).toBe("compatibility-renderer");
    expect(source.origin).toBe("https://admin.example.com");
    expect(source.url).toContain("/themes/theme-1/preview");
  });

  it("stays on it while a preview server is still starting", () => {
    for (const previewServerUrl of [null, undefined]) {
      expect(
        resolveLivePreviewSource({
          ...BASE,
          executionMode: "user-code",
          previewServerUrl,
        }).kind,
      ).toBe("compatibility-renderer");
    }
  });

  it("frames the preview server once there is one to frame", () => {
    const source = resolveLivePreviewSource({
      ...BASE,
      executionMode: "user-code",
      previewServerUrl: SERVER_URL,
    });
    expect(source.kind).toBe("preview-server");
    expect(source.origin).toBe("https://5173-sbx1-tok.preview.example.com");
  });

  it("tells a preview server nothing about templates or routes", () => {
    // A real Theme serves its own pages and is told which to show after it
    // connects, not through the address it was loaded from.
    const source = resolveLivePreviewSource({
      ...BASE,
      executionMode: "user-code",
      routePath: "/about",
      previewServerUrl: SERVER_URL,
    });
    expect(source.url).not.toContain("templateId");
    expect(source.url).not.toContain("routePath");
  });
});

describe("the channel a preview talks back through", () => {
  it("carries the editor's origin and the session it belongs to", () => {
    const url = new URL(
      withPreviewChannel(SERVER_URL, {
        editorOrigin: BASE.editorOrigin,
        previewSession: BASE.previewSession,
      }),
    );
    expect(url.searchParams.get("editorOrigin")).toBe(BASE.editorOrigin);
    expect(url.searchParams.get("previewSession")).toBe(BASE.previewSession);
  });

  it("keeps a query the preview URL already had", () => {
    const url = new URL(
      withPreviewChannel(
        "https://5173-sbx1-tok.preview.example.com/?token=abc",
        {
          editorOrigin: BASE.editorOrigin,
          previewSession: BASE.previewSession,
        },
      ),
    );
    expect(url.searchParams.get("token")).toBe("abc");
    expect(url.searchParams.get("previewSession")).toBe(BASE.previewSession);
  });
});
