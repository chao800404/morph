// @vitest-environment node
import { parse } from "@babel/parser";
import { describe, expect, it } from "vitest";
import {
  themePreviewBridgeEntrySource,
  THEME_PREVIEW_BRIDGE_PATH,
} from "./theme-preview-bridge-entry";
import { GENERATED_PREVIEW_BRIDGE_SOURCES } from "./preview-bridge-sources.generated";

const BRIDGE = themePreviewBridgeEntrySource();

describe("the script a Live Preview page runs for the editor", () => {
  it("is something a Theme workspace can actually load", () => {
    expect(() =>
      parse(BRIDGE, { sourceType: "module", plugins: ["typescript"] }),
    ).not.toThrow();
    expect(THEME_PREVIEW_BRIDGE_PATH).toMatch(/^src\/morph\/.+\.ts$/);
  });

  it("says nothing when no editor is behind the page", () => {
    // Someone following a preview URL directly gets a working storefront, not
    // messages fired at whatever happens to be hosting them.
    expect(BRIDGE).toContain(
      "const channel = readPreviewRuntimeChannel(window.location.href);",
    );
    expect(BRIDGE.match(/if \(!channel\) return;/g)?.length).toBeGreaterThan(1);
  });

  it("leaves clicks to the Theme until the editor asks for them", () => {
    // Interact mode is the default, so a preview being watched behaves like
    // the real storefront: links follow, menus open, carousels advance.
    expect(BRIDGE).toContain("let selectionEnabled = false;");
    expect(BRIDGE).toContain("if (!selectionEnabled) return;");
  });

  it("takes the click away from the Theme once it does", () => {
    // Capture and stop, so a Theme's own link or handler cannot make an
    // element unselectable.
    expect(BRIDGE).toContain("event.preventDefault();");
    expect(BRIDGE).toContain("event.stopPropagation();");
    expect(BRIDGE).toContain("{ capture: true }");
  });

  it("decides nothing about trust for itself", () => {
    // Origin, source, session and schema all stay with the protocol module
    // the editor was tested against.
    expect(BRIDGE).toContain("parseEditorToPreviewWindowEvent(event)");
    expect(BRIDGE).toContain("postPreviewToEditorMessage(");
    expect(BRIDGE).not.toContain("event.origin");
    expect(BRIDGE).not.toContain("window.parent.postMessage");
  });
});

describe("the protocol copied in beside it", () => {
  it("carries every module the bridge imports", () => {
    const copied = new Set(
      GENERATED_PREVIEW_BRIDGE_SOURCES.map((module) =>
        module.path.replace("src/morph/preview/", "").replace(/\.ts$/, ""),
      ),
    );
    for (const source of [...BRIDGE.matchAll(/from "\.\/preview\/([^"]+)"/g)]) {
      expect(copied).toContain(source[1]);
    }
    expect(copied.size).toBeGreaterThanOrEqual(5);
  });

  it("has nothing left pointing back at Morph", () => {
    // The container holds no Morph code, so an import that survived the copy
    // would only fail once a customer opened their preview.
    for (const module of GENERATED_PREVIEW_BRIDGE_SOURCES) {
      const specifiers = [...module.content.matchAll(/from "([^"]+)"/g)].map(
        (match) => match[1],
      );
      for (const specifier of specifiers) {
        expect(
          specifier.startsWith("@/"),
          `${module.path} -> ${specifier}`,
        ).toBe(false);
        if (specifier.startsWith("./")) {
          expect(
            GENERATED_PREVIEW_BRIDGE_SOURCES.some(
              (other) =>
                other.path === `src/morph/preview/${specifier.slice(2)}.ts`,
            ),
            `${module.path} -> ${specifier}`,
          ).toBe(true);
        }
      }
    }
  });
});

describe("reporting how tall the preview is", () => {
  it("measures the Theme's own mount, because there is no Morph wrapper", () => {
    expect(BRIDGE).toContain("startPreviewHeightReporter({");
    expect(BRIDGE).toContain(
      'document.getElementById("root") ?? document.body',
    );
  });

  it("uses the same reporter the compatibility renderer does", () => {
    // Waiting for the height to hold still, waiting for fonts and images,
    // resolving the root per measurement: none of it is obvious, and a second
    // implementation would get a different one of them wrong.
    expect(BRIDGE).toContain('from "./preview/preview-height-reporter"');
  });
});

describe("showing what is selected and what is under the pointer", () => {
  it("draws with the same controller the compatibility renderer uses", () => {
    expect(BRIDGE).toContain("createPreviewSelectionOverlays()");
    expect(BRIDGE).toContain('from "./preview/preview-selection-overlays"');
  });

  it("redraws only when the pointer reaches a different element", () => {
    // pointermove fires on every pixel, and the geometry it would otherwise
    // recompute is the expensive part.
    expect(BRIDGE).toContain(
      "if (item?.element === hoveredItem?.element) return;",
    );
  });

  it("follows the page, because the rings are in viewport coordinates", () => {
    expect(BRIDGE).toContain('for (const moved of ["scroll", "resize"])');
  });

  it("drops the highlight when select mode ends", () => {
    // A ring left behind would point at something no longer clickable.
    const clearing = BRIDGE.slice(BRIDGE.indexOf("if (!selectionEnabled) {"));
    expect(clearing).toContain("hoveredItem = null;");
    expect(clearing).toContain("selectedItem = null;");
  });
});
