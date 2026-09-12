// @vitest-environment node
import { describe, expect, it } from "vitest";
import { deriveThemePreviewSessionId } from "./theme-preview-session-id";

const KEY = {
  storefrontId: "storefront-1",
  themeId: "theme-1",
  userId: "user-1",
};

describe("naming an editor's preview container", () => {
  it("returns the same container for the same editor and Theme", async () => {
    // This is what makes reopening the editor reattach to a warm server
    // instead of paying a cold start.
    expect(await deriveThemePreviewSessionId(KEY)).toBe(
      await deriveThemePreviewSessionId(KEY),
    );
  });

  it("gives two editors separate containers for the same Theme", async () => {
    expect(await deriveThemePreviewSessionId(KEY)).not.toBe(
      await deriveThemePreviewSessionId({ ...KEY, userId: "user-2" }),
    );
  });

  it("separates Themes, and storefronts, for the same editor", async () => {
    const base = await deriveThemePreviewSessionId(KEY);
    expect(
      await deriveThemePreviewSessionId({ ...KEY, themeId: "theme-2" }),
    ).not.toBe(base);
    expect(
      await deriveThemePreviewSessionId({
        ...KEY,
        storefrontId: "storefront-2",
      }),
    ).not.toBe(base);
  });

  it("cannot be read back to say who is editing what", async () => {
    // The id travels in a public preview hostname, so it must not carry the
    // ids it was built from.
    const id = await deriveThemePreviewSessionId(KEY);
    for (const part of Object.values(KEY)) {
      expect(id).not.toContain(part);
    }
  });

  it("fits in a DNS label beside a port and a token", async () => {
    const id = await deriveThemePreviewSessionId(KEY);
    expect(id).toMatch(/^[0-9a-f]{32}$/);
    expect(`5173-${id}-0123456789abcdef`.length).toBeLessThanOrEqual(63);
  });

  it("keeps keys apart that would otherwise flatten into one string", async () => {
    // Without length-prefixing, ("ab","c") and ("a","bc") hash the same input.
    expect(
      await deriveThemePreviewSessionId({
        storefrontId: "ab",
        themeId: "c",
        userId: "u",
      }),
    ).not.toBe(
      await deriveThemePreviewSessionId({
        storefrontId: "a",
        themeId: "bc",
        userId: "u",
      }),
    );
  });

  it("refuses to name a container without knowing whose it is", async () => {
    for (const missing of ["storefrontId", "themeId", "userId"] as const) {
      await expect(
        deriveThemePreviewSessionId({ ...KEY, [missing]: "  " }),
      ).rejects.toThrow("INVALID_PREVIEW_SESSION_KEY");
    }
  });
});
