import { describe, expect, it } from "vitest";
import { resolveInspectorModules } from "./inspector-modules";

describe("resolveInspectorModules", () => {
  it("exposes media controls for an image", () => {
    expect(resolveInspectorModules({
      tagName: "img",
      contentFieldBinding: "hero.image",
      sourceEditability: { className: true },
    })).toEqual([
      "content", "media", "sizing", "spacing", "position", "appearance", "fill", "border",
      "effects", "accessibility", "source-style",
    ]);
  });

  it("exposes content and typography for a heading", () => {
    expect(resolveInspectorModules({ tagName: "h1" })).toContainEqual("content");
    expect(resolveInspectorModules({ tagName: "h1" })).toEqual(expect.arrayContaining([
      "content", "typography", "sizing", "spacing", "appearance", "border", "effects",
    ]));
  });

  it("exposes layout and fill for a section container", () => {
    const modules = resolveInspectorModules({ tagName: "section", isSection: true });
    expect(modules).toEqual(expect.arrayContaining(["layout", "sizing", "spacing", "position", "fill"]));
  });

  it("exposes interaction and accessibility for controls", () => {
    const button = resolveInspectorModules({ tagName: "button" });
    const input = resolveInspectorModules({ tagName: "input", inputType: "email" });
    expect(button).toEqual(expect.arrayContaining(["content", "interaction"]));
    expect(input).toEqual(expect.arrayContaining(["content", "interaction", "accessibility"]));
  });

  it("always exposes position mode while the UI can gate X and Y by computed position", () => {
    expect(resolveInspectorModules({ tagName: "div", computedStyle: { position: "absolute" } }))
      .toContain("position");
    expect(resolveInspectorModules({ tagName: "div", computedStyle: { position: "static" } }))
      .toContain("position");
  });

  it("does not expose source editing for dynamic class/style sources", () => {
    expect(resolveInspectorModules({
      tagName: "div",
      sourceEditability: { className: true, style: true, dynamic: true },
    })).not.toContain("source-style");
  });

  it("supports allowlisted include/exclude overrides and ignores unknown values", () => {
    const modules = resolveInspectorModules({
      tagName: "p",
      override: {
        include: ["media", "not-a-module", "media"],
        exclude: ["typography", "also-invalid"],
      },
    });
    expect(modules).toContain("media");
    expect(modules).not.toContain("typography");
    expect(modules.filter((module) => module === "media")).toHaveLength(1);
    expect(modules).not.toContain("not-a-module");
  });

  it("parses a static DOM string override through the same allowlist", () => {
    expect(resolveInspectorModules({
      tagName: "img",
      override: "media sizing unknown appearance",
    })).toEqual(["media", "sizing", "appearance"]);
    expect(resolveInspectorModules({
      tagName: "img",
      override: "[\"media\",\"border\",\"invalid\"]",
    })).toEqual(["media", "border"]);
  });

  it("treats a readonly array override as a complete allowlisted profile", () => {
    expect(resolveInspectorModules({
      tagName: "img",
      override: ["media", "media", "unknown", "sizing"],
    })).toEqual(["media", "sizing"]);
  });
});

