// @vitest-environment node
import { describe, expect, it } from "vitest";
import {
  resolveLivePreviewSource,
  withPreviewChannel,
} from "./live-preview-source";

const BASE = {
  editorOrigin: "https://admin.example.com",
  previewSession: "3f2504e0-4f89-41d3-9a0c-0305e82c3301",
} as const;

const SERVER_URL = "https://5173-sbx1-tok.preview.example.com/";

describe("choosing which preview the editor frames", () => {
  it("frames nothing while the real React preview is still starting", () => {
    for (const previewServerUrl of [null, undefined]) {
      expect(
        resolveLivePreviewSource({
          ...BASE,
          previewServerUrl,
        }),
      ).toBeNull();
    }
  });

  it("frames the preview server once there is one to frame", () => {
    const source = resolveLivePreviewSource({
      ...BASE,
      previewServerUrl: SERVER_URL,
    });
    expect(source?.kind).toBe("preview-server");
    expect(source?.origin).toBe("https://5173-sbx1-tok.preview.example.com");
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
  } as const;
  const LOCAL_SERVER = "https://5173-sbx1-ux_tok.preview.localhost/?x=1";

  it("loads it where the Worker is actually listening", () => {
    // A container always mints https, which is right behind TLS and wrong on
    // a machine that has none.
    const source = resolveLivePreviewSource({
      ...LOCAL,
      previewServerUrl: LOCAL_SERVER,
    });
    const url = new URL(source!.url);
    expect(url.protocol).toBe("http:");
    expect(url.port).toBe("3000");
    expect(url.hostname).toBe("5173-sbx1-ux_tok.preview.localhost");
    expect(url.searchParams.get("x")).toBe("1");
    expect(source!.origin).toBe(url.origin);
  });

  it("leaves a deployment's address exactly as the container gave it", () => {
    // The editor is not on loopback there, so neither condition holds and
    // nothing depends on a build-time switch being set correctly.
    const source = resolveLivePreviewSource({
      ...BASE,
      previewServerUrl: "https://5173-sbx1-tok.preview.example.com/",
    });
    expect(new URL(source!.url).protocol).toBe("https:");
    expect(new URL(source!.url).port).toBe("");
  });

  it("does not downgrade a real host just because the editor is local", () => {
    const source = resolveLivePreviewSource({
      ...LOCAL,
      previewServerUrl: "https://5173-sbx1-tok.preview.example.com/",
    });
    expect(new URL(source!.url).protocol).toBe("https:");
  });

  it("does not touch a local preview for an editor served over https", () => {
    const source = resolveLivePreviewSource({
      ...BASE,
      previewServerUrl: LOCAL_SERVER,
    });
    expect(new URL(source!.url).protocol).toBe("https:");
  });
});
