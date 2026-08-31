import { describe, expect, it } from "vitest";
import {
  buildLivePreviewUrl,
  resolveLivePreviewSecurity,
} from "./live-preview-security";

describe("live preview security", () => {
  it("keeps the current compatibility renderer available on the editor origin", () => {
    expect(
      resolveLivePreviewSecurity({
        editorOrigin: "https://editor.example.com",
        executionMode: "compatibility-renderer",
      }),
    ).toEqual({
      enabled: true,
      previewOrigin: "https://editor.example.com",
      sandbox: "allow-same-origin allow-scripts",
    });
  });

  it("fails closed when user code has no valid isolated preview origin", () => {
    expect(
      resolveLivePreviewSecurity({
        editorOrigin: "https://editor.example.com",
        executionMode: "user-code",
      }),
    ).toEqual({ enabled: false, reason: "MISSING_PREVIEW_ORIGIN" });
    expect(
      resolveLivePreviewSecurity({
        editorOrigin: "https://editor.example.com",
        configuredPreviewOrigin: "https://editor.example.com/preview",
        executionMode: "user-code",
      }),
    ).toEqual({
      enabled: false,
      reason: "SAME_ORIGIN_USER_CODE_PREVIEW",
    });
    expect(
      resolveLivePreviewSecurity({
        editorOrigin: "https://editor.example.com",
        configuredPreviewOrigin: "javascript:alert(1)",
        executionMode: "user-code",
      }),
    ).toEqual({ enabled: false, reason: "INVALID_PREVIEW_ORIGIN" });
  });

  it("allows user code only on an explicit cross-origin host", () => {
    expect(
      resolveLivePreviewSecurity({
        editorOrigin: "https://editor.example.com",
        configuredPreviewOrigin: "https://preview.example.net",
        executionMode: "user-code",
      }),
    ).toEqual({
      enabled: true,
      previewOrigin: "https://preview.example.net",
      sandbox: "allow-same-origin allow-scripts",
    });
  });

  it("builds a scoped preview URL with editor origin and session", () => {
    const url = new URL(
      buildLivePreviewUrl({
        previewOrigin: "https://preview.example.net",
        storefrontId: "store 1",
        themeId: "theme/1",
        templateId: "11111111-1111-4111-8111-111111111111",
        routePath: "/about",
        viewportHeight: 900,
        editorOrigin: "https://editor.example.com",
        previewSession: "22222222-2222-4222-8222-222222222222",
      }),
    );
    expect(url.origin).toBe("https://preview.example.net");
    expect(url.pathname).toBe("/store/store%201/themes/theme%2F1/preview");
    expect(url.searchParams.get("routePath")).toBe("/about");
    expect(url.searchParams.get("editorOrigin")).toBe(
      "https://editor.example.com",
    );
    expect(url.searchParams.get("previewSession")).toBe(
      "22222222-2222-4222-8222-222222222222",
    );
  });
});
