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

describe("reaching a preview server from a developer's own machine", () => {
  const LOCAL = {
    ...BASE,
    editorOrigin: "http://localhost:3000",
    compatibilityOrigin: "http://localhost:3000",
    executionMode: "user-code",
  } as const;
  const LOCAL_SERVER = "https://5173-sbx1-ux_tok.preview.localhost/?x=1";

  it("loads it where the Worker is actually listening", () => {
    // A container always mints https, which is right behind TLS and wrong on
    // a machine that has none.
    const source = resolveLivePreviewSource({
      ...LOCAL,
      previewServerUrl: LOCAL_SERVER,
    });
    const url = new URL(source.url);
    expect(url.protocol).toBe("http:");
    expect(url.port).toBe("3000");
    expect(url.hostname).toBe("5173-sbx1-ux_tok.preview.localhost");
    expect(url.searchParams.get("x")).toBe("1");
    expect(source.origin).toBe(url.origin);
  });

  it("leaves a deployment's address exactly as the container gave it", () => {
    // The editor is not on loopback there, so neither condition holds and
    // nothing depends on a build-time switch being set correctly.
    const source = resolveLivePreviewSource({
      ...BASE,
      executionMode: "user-code",
      previewServerUrl: "https://5173-sbx1-tok.preview.example.com/",
    });
    expect(new URL(source.url).protocol).toBe("https:");
    expect(new URL(source.url).port).toBe("");
  });

  it("does not downgrade a real host just because the editor is local", () => {
    const source = resolveLivePreviewSource({
      ...LOCAL,
      previewServerUrl: "https://5173-sbx1-tok.preview.example.com/",
    });
    expect(new URL(source.url).protocol).toBe("https:");
  });

  it("does not touch a local preview for an editor served over https", () => {
    const source = resolveLivePreviewSource({
      ...BASE,
      executionMode: "user-code",
      previewServerUrl: LOCAL_SERVER,
    });
    expect(new URL(source.url).protocol).toBe("https:");
  });
});
