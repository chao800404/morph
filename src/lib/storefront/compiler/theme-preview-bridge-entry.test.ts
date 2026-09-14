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
  it("answers liveness probes from the editor", () => {
    expect(BRIDGE).toContain('"morph:storefront-preview-ping"');
    expect(BRIDGE).toContain('"morph:storefront-preview-pong"');
    expect(BRIDGE).toContain("heartbeatId: message.heartbeatId");
  });

  it("counts selection moves so its answer is not read as the oldest one", () => {
    // Enabling the tool is itself a request, so an answer carrying no count is
    // older than it and discarded. Together with the style revision this is
    // why clicking the canvas selected nothing in the real preview.
    expect(BRIDGE).toContain("selectionRevision += 1");
    expect(BRIDGE).toContain("selectionRevision,");
    expect(BRIDGE).toContain("Math.max(\n          selectionRevision,");
  });

  it("stamps the revision every answer it sends is measured against", () => {
    // The editor discards any answer that is not for the revision it last
    // asked about. Without this the page reported revision zero forever, so
    // every selection made on the canvas was dropped as stale and clicking
    // selected nothing at all.
    expect(BRIDGE).toContain(
      "document.documentElement.dataset.storefrontStyleRevision",
    );
    expect(BRIDGE).toContain(
      "String(\n        message.styleRevision,\n      )",
    );
  });

  it("reports structure after React commits the real preview DOM", () => {
    // The bridge is a sibling module script, so load/ready can run before
    // React's first commit and truthfully report an empty tree. DOM commits
    // must schedule a fresh, coalesced snapshot for deep canvas selection.
    expect(BRIDGE).toContain("new MutationObserver(scheduleStructureReport)");
    expect(BRIDGE).toContain("childList: true");
    expect(BRIDGE).toContain("structureReportFrame !== null");
    expect(BRIDGE).not.toContain(
      'attributeFilter: [\n      "data-storefront-editor-selected"',
    );
  });

  it("says on the document which tool the pointer is", () => {
    // The editor's cursors are CSS reacting to these, and the browser tests
    // wait on the first one to know the tool actually reached the preview.
    // Both were implemented only in the renderer the editor no longer loads.
    expect(BRIDGE).toContain('"data-storefront-editor-selection-enabled"');
    expect(BRIDGE).toContain('"data-storefront-editor-pan-enabled"');
  });

  it("carries the editor's own cursors and empty-line layout", () => {
    // Without the stylesheet nothing shows a section is selectable, and an
    // empty text line collapses to no height, which is a line the author can
    // see and cannot click into.
    expect(BRIDGE).toContain("cursor: pointer !important");
    expect(BRIDGE).toContain("cursor: grab !important");
    expect(BRIDGE).toContain("data-storefront-editor-empty-text-line");
  });

  it("forwards the wheel, because the editor cannot see it", () => {
    // The preview fills the canvas. Once the pointer is over it the editor
    // receives no wheel events of its own, so scrolling the storefront and
    // Ctrl-zooming the canvas both depend on this being here — and it was
    // implemented only in the renderer the editor no longer uses, which is
    // how it went missing without a single test failing.
    expect(BRIDGE).toContain('"morph:storefront-preview-wheel"');
    expect(BRIDGE).toContain("ctrlKey: event.ctrlKey");
  });

  it("takes the wheel event rather than letting the browser zoom the page", () => {
    // A wheel listener on window is passive by default and a passive listener
    // cannot preventDefault, which would leave the browser zooming the preview
    // document underneath a canvas that is trying to scale it.
    const listener = BRIDGE.slice(BRIDGE.indexOf('"wheel"'));
    expect(listener).toContain("event.preventDefault()");
    expect(listener).toContain("{ passive: false }");
  });

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

describe("applying document changes to the real React preview", () => {
  it("updates the preview content cache and hides the rendered section", () => {
    expect(BRIDGE).toContain('from "./preview-content"');
    const update = BRIDGE.slice(
      BRIDGE.indexOf('"morph:storefront-preview-update-section-props"'),
    );
    expect(update).toContain("updatePreviewContent(");
    expect(update).toContain(
      'section.toggleAttribute("hidden", !message.enabled)',
    );
  });

  it("moves only sibling sections when the document order changes", () => {
    const reorder = BRIDGE.slice(
      BRIDGE.indexOf('"morph:storefront-preview-set-section-order"'),
    );
    expect(reorder).toContain(
      "ordered.every((section) => section.parentElement === parent)",
    );
    expect(reorder).toContain("parent.appendChild(section)");
  });
});

describe("reversing a style change in the real React preview", () => {
  it("clears the inline carry-over before the source is rendered again", () => {
    const reset = BRIDGE.slice(
      BRIDGE.indexOf(
        '"morph:storefront-preview-reset-selection-style-preview"',
      ),
    );
    expect(reset).toContain("selectionStylePreview.clear();");
    expect(reset).not.toContain("holdCurrentStyles");
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

describe("editing text in the page it is rendered on", () => {
  it("uses the same editor the compatibility renderer does", () => {
    expect(BRIDGE).toContain("createInlineTextEditor({");
    expect(BRIDGE).toContain('from "./preview/inline-text-editor"');
  });

  it("opens on a double click, before the click handler takes the event", () => {
    // Editing needs the caret the browser is about to place, which a
    // preventDefault on the click would have thrown away.
    const dbl = BRIDGE.indexOf('"dblclick"');
    const click = BRIDGE.indexOf('"click"');
    expect(dbl).toBeGreaterThan(-1);
    expect(dbl).toBeLessThan(click);
  });

  it("leaves a click inside the text being edited alone", () => {
    // Taking it would end the edit on the first click into it.
    expect(BRIDGE).toContain("const editing = inlineEditor.editingElement();");
    expect(BRIDGE).toContain("editing.contains(event.target)");
  });

  it("sends what was typed through the commit message", () => {
    expect(BRIDGE).toContain(
      '{ type: "morph:storefront-preview-commit-inline-text", ...commit }',
    );
  });
});

describe("dragging something into a new position", () => {
  it("decides what a drop means with the rule the editor shares", () => {
    expect(BRIDGE).toContain('from "./preview/preview-reorder-identity"');
    expect(BRIDGE).toContain("reorderCommitFor(held, target.identity)");
  });

  it("starts only from the handle on the selection ring", () => {
    // A Theme's own draggable content keeps behaving as it does on the real
    // storefront.
    expect(BRIDGE).toContain(
      "event.target.closest('[data-storefront-editor-drag-handle=\"true\"]')",
    );
  });

  it("shows the handle only on something that can actually move", () => {
    // Its absence answers "why can I not drag this", rather than a drag that
    // starts and then quietly does nothing.
    expect(BRIDGE).toContain("function syncDragHandle()");
    expect(BRIDGE).toContain("reorderIdentity(selectedItem.element)");
  });

  it("accepts a drop only over a compatible sibling", () => {
    // The browser cancels a drop unless the default is prevented over it, so
    // refusing to prevent is how an incompatible target says no.
    expect(BRIDGE).toContain("if (!dropTargetUnder(event.target)) return;");
  });

  it("shows the new order at once, and tells the editor separately", () => {
    expect(BRIDGE).toContain('document.createComment("morph-reorder")');
    expect(BRIDGE).toContain("postPreviewToEditorMessage(commit, channel)");
  });

  it("ends the gesture even when the drop never happens", () => {
    expect(BRIDGE).toContain('document.addEventListener("dragend"');
  });
});

describe("changing which page the editor is showing", () => {
  it("navigates the Theme's own router rather than reloading the page", () => {
    expect(BRIDGE).toContain("window.__morphPreviewRouter");
    expect(BRIDGE).toContain(
      'router.navigate({ to: message.routePath ?? "/" })',
    );
  });

  it("does nothing when no router was handed over", () => {
    // Staying put beats reloading the page out from under an edit.
    expect(BRIDGE).toContain("if (router) {");
  });

  it("drops selection and re-reads the page it lands on", () => {
    // A different route is a different set of elements entirely.
    const routing = BRIDGE.slice(BRIDGE.indexOf("__morphPreviewRouter"));
    expect(routing).toContain("selectedItem = null;");
    expect(routing).toContain("reportStructure");
  });
});

describe("confirming the Theme source the editor is waiting on", () => {
  it("applies Vite's native HMR payload over the preview HTTP bridge", () => {
    expect(BRIDGE).toContain("/_morph/hmr?cursor=1");
    expect(BRIDGE).toContain("/_morph/hmr?after=");
    expect(BRIDGE).toContain("globalThis.__morphApplyViteHmrPayload");
    expect(BRIDGE).toContain("await applyPayload(entry.payload)");
    expect(BRIDGE).not.toContain("window.location.reload()");
  });

  it("confirms only once the page has taken the update", () => {
    // Morph writes the files into the container and the page updates itself.
    // Saying "applied" on receiving the message would report someone else's
    // work as done, and the editor would trust a preview showing the old one.
    expect(BRIDGE).toContain('import.meta.hot.on("vite:afterUpdate"');
    const onMessage = BRIDGE.slice(
      BRIDGE.indexOf("morph:storefront-preview-update-theme-files"),
    );
    expect(onMessage).toContain(
      "pendingStyleRevision = message.styleRevision;",
    );
    expect(onMessage).not.toContain("theme-files-applied");
  });

  it("says so when the update failed instead of leaving the editor waiting", () => {
    expect(BRIDGE).toContain('import.meta.hot.on("vite:error"');
    expect(BRIDGE).toContain("morph:storefront-preview-theme-files-failed");
  });

  it("re-reads the page, because the update changed what is on it", () => {
    const afterUpdate = BRIDGE.slice(BRIDGE.indexOf('"vite:afterUpdate"'));
    expect(afterUpdate.slice(0, 600)).toContain(
      "acknowledgePendingStyleRevision();",
    );
    expect(
      BRIDGE.slice(BRIDGE.indexOf("function acknowledgePendingStyleRevision")),
    ).toContain("reportStructure();");
  });

  it("confirms each revision once", () => {
    const afterUpdate = BRIDGE.slice(BRIDGE.indexOf('"vite:afterUpdate"'));
    expect(afterUpdate).toContain("pendingStyleRevision = null;");
  });
});
