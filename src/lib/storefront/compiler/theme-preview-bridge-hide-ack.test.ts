// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import { previewSectionSelector } from "@/lib/storefront/editor/preview-dom";
import { themePreviewBridgeEntrySource } from "./theme-preview-bridge-entry";

/**
 * M3 Hide approach E: when the bridge may acknowledge a Hide.
 *
 * A hidden section is one Morph's compiled guard does not render. A section
 * still in the DOM under a `hidden` attribute, or marked
 * `data-morph-section-hidden`, still rendered (with its stored values or its
 * defaults) and only looks hidden on the canvas; the published site would
 * show it. So only its absence acknowledges a Hide.
 *
 * The bridge's check is run as written, cut from the generated script.
 */

// jsdom has no CSS.escape, which the bridge's selector uses in a browser.
const cssGlobal = globalThis as { CSS?: { escape?: (value: string) => string } };
cssGlobal.CSS ??= {};
cssGlobal.CSS.escape ??= (value: string) => value.replace(/["\\]/g, "\\$&");

const BRIDGE = themePreviewBridgeEntrySource();
const start = BRIDGE.indexOf("function isSectionPresentationCommitted");
const end = BRIDGE.indexOf("function flushPendingPresentationTokens");
const committed = new Function(
  "previewSectionSelector",
  "document",
  `${BRIDGE.slice(start, end)}\nreturn isSectionPresentationCommitted;`,
)(previewSectionSelector, document) as (
  sectionId: string,
  enabled: boolean,
) => boolean;

const page = (html: string) => {
  document.body.innerHTML = html;
};

afterEach(() => {
  document.body.innerHTML = "";
});

describe("a Hide is acknowledged only once the section is gone", () => {
  it("found the check in the bridge", () => {
    expect(start).toBeGreaterThan(0);
    expect(end).toBeGreaterThan(start);
  });

  it("acknowledges a Hide when the section is not rendered at all", () => {
    page(`<main><div data-storefront-section-id="other"></div></main>`);
    expect(committed("hero", false)).toBe(true);
  });

  it("does not take a section under a hidden attribute for a hidden one", () => {
    page(`<main><div data-storefront-section-id="hero" hidden style="display: contents"><h1>HERO-DEFAULT</h1></div></main>`);
    expect(committed("hero", false)).toBe(false);
  });

  it("does not take a section marked data-morph-section-hidden for a hidden one", () => {
    page(`<main><div data-storefront-section-id="hero" data-morph-section-hidden><h1>HERO-DEFAULT</h1></div></main>`);
    expect(committed("hero", false)).toBe(false);
  });

  it("control: a Show is acknowledged by one rendered, unmarked section", () => {
    page(`<main><div data-storefront-section-id="hero"><h1>Stored</h1></div></main>`);
    expect(committed("hero", true)).toBe(true);
    page(`<main><div data-storefront-section-id="hero" hidden></div></main>`);
    expect(committed("hero", true)).toBe(false);
  });
});
