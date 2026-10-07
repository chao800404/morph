// @vitest-environment node
import { describe, expect, it } from "vitest";
import {
  PREVIEW_RUNTIME_INTERRUPTED_STATUS,
  previewLoadWasInterrupted,
} from "./preview-runtime-interruption";

describe("previewLoadWasInterrupted", () => {
  const entry = "/__morph-theme-preview__/__entry.tsx";

  it("recognises a module graph broken by an interruption the proxy gave up on", () => {
    expect(
      previewLoadWasInterrupted({
        failedScripts: [entry],
        failures: [
          { path: "/static/missing.png", status: 404 },
          {
            path: "/__morph-theme-preview__/src/routes/products.$slug.tsx",
            status: PREVIEW_RUNTIME_INTERRUPTED_STATUS,
          },
        ],
      }),
    ).toBe(true);
  });

  it("leaves a Theme's own compile error to the Theme", () => {
    expect(
      previewLoadWasInterrupted({
        failedScripts: [entry],
        failures: [{ path: "/src/routes/index.tsx", status: 500 }],
      }),
    ).toBe(false);
  });

  it("does not reload a page whose scripts all ran", () => {
    expect(
      previewLoadWasInterrupted({
        failedScripts: [],
        failures: [
          { path: "/api/x", status: PREVIEW_RUNTIME_INTERRUPTED_STATUS },
        ],
      }),
    ).toBe(false);
  });

  it("claims nothing for a browser that reports no statuses", () => {
    expect(
      previewLoadWasInterrupted({ failedScripts: [entry], failures: [] }),
    ).toBe(false);
  });
});
