import { act, render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useStorefrontPreviewSelectionBridge } from "../store/$storefrontId/themes/$themeId/preview";

/**
 * Morph's own preview route (`preview.tsx`) and `update-selection-field`.
 *
 * The route's selection bridge runs in a page framed by the editor. Here it
 * is mounted in jsdom with the parent replaced by a real window (a blank
 * iframe's) that stands for the editor: the route reads its channel from its
 * URL, takes messages only from that parent and origin, and posts to it.
 *
 * - It says on ready that it reads the section a selection-field post names.
 * - It applies a post only to the section the post names, while that is the
 *   section selected and still on the page as the element found for its id.
 * - Anything else writes nothing and says nothing back to the editor.
 *
 * Hidden sections: the route never renders one (`StorefrontDocumentRenderer`
 * filters `enabled !== false`, storefront-document-renderer.tsx:208-210; the
 * Theme renderer returns null for `render: false`, which is
 * `enabled !== false`, safe-theme-route-renderer.tsx:114 and
 * safe-theme-component-renderer.tsx:1685), so a hidden section is one the id
 * finds no element for — B4 here.
 */

// jsdom has no `CSS.escape`; the ids here need no escaping, only a function.
if (typeof globalThis.CSS?.escape !== "function") {
  (globalThis as { CSS?: unknown }).CSS = {
    escape: (value: string) => value.replace(/(["\\])/g, "\\$1"),
  };
}

const EDITOR_ORIGIN = "http://localhost:3000";
const PREVIEW_SESSION = "5f0f0f6e-6c2e-4f1c-9a3e-0f9a2b7c1d4e";

let editor: Window;
let posted: unknown[];
let debug: ReturnType<typeof vi.spyOn>;

function Bridge() {
  useStorefrontPreviewSelectionBridge(true);
  return null;
}

function fromEditor(data: Record<string, unknown>) {
  act(() => {
    window.dispatchEvent(
      new MessageEvent("message", {
        data: { ...data, previewSession: PREVIEW_SESSION },
        origin: EDITOR_ORIGIN,
        source: editor,
      }),
    );
  });
}

beforeEach(() => {
  window.history.replaceState(
    null,
    "",
    `/preview?editorOrigin=${encodeURIComponent(EDITOR_ORIGIN)}&previewSession=${PREVIEW_SESSION}`,
  );
  const frame = document.createElement("iframe");
  document.body.appendChild(frame);
  editor = frame.contentWindow!;
  posted = [];
  vi.spyOn(editor, "postMessage").mockImplementation(((message: unknown) => {
    posted.push(message);
  }) as never);
  Object.defineProperty(window, "parent", { value: editor, configurable: true });
  debug = vi.spyOn(console, "debug").mockImplementation(() => {});
  const page = document.createElement("main");
  page.innerHTML = `
    <section data-storefront-section-id="hero">
      <h1 data-storefront-field="heading" data-storefront-field-path="heading">Stored heading</h1>
      <img data-storefront-field-path="image" src="/stored.jpg" alt="Stored alt" />
    </section>
    <section data-storefront-section-id="other">
      <h1 data-storefront-field="heading" data-storefront-field-path="heading">Other heading</h1>
    </section>`;
  document.body.appendChild(page);
});

afterEach(() => {
  Object.defineProperty(window, "parent", { value: window, configurable: true });
  vi.restoreAllMocks();
  document.body.innerHTML = "";
});

const hero = () => document.querySelector<HTMLElement>('[data-storefront-section-id="hero"]')!;
const heroHeading = () => hero().querySelector("h1")!.textContent;

function selectHero() {
  render(<Bridge />);
  fromEditor({ type: "morph:storefront-preview-set-selection-mode", enabled: true });
  fromEditor({ type: "morph:storefront-preview-set-section", sectionId: "hero" });
}

const field = (sectionId: string, fieldKey: string, fieldPath: string, value: string) => ({
  type: "morph:storefront-preview-update-selection-field",
  sectionId,
  fieldKey,
  fieldPath,
  value,
});

describe("Morph's preview route and a selection-field post", () => {
  it("says on ready that it reads the section the post names", () => {
    render(<Bridge />);
    const ready = posted.find(
      (message) => (message as { type?: string }).type === "morph:storefront-preview-ready",
    );
    expect(ready).toMatchObject({ capabilities: ["selection-field-section"] });
  });

  it("applies a post to the selected section it names", () => {
    selectHero();
    fromEditor(field("hero", "heading", "heading", "Typed"));
    expect(heroHeading()).toBe("Typed");
  });

  it("B2: writes nothing for a section other than the one selected", () => {
    selectHero();
    fromEditor(field("other", "heading", "heading", "Typed"));
    expect(heroHeading()).toBe("Stored heading");
    expect(document.querySelector('[data-storefront-section-id="other"] h1')!.textContent).toBe(
      "Other heading",
    );
    expect(debug).toHaveBeenCalledTimes(1);
  });

  it("B2: writes nothing for another id that finds the selected element too", () => {
    hero().setAttribute("data-morph-section", "alias");
    selectHero();
    fromEditor(field("alias", "heading", "heading", "Typed"));
    expect(heroHeading()).toBe("Stored heading");
    expect(debug).toHaveBeenCalledTimes(1);
  });

  it("B4: writes nothing once the selected section has left the page", () => {
    selectHero();
    const detached = hero();
    detached.remove();
    fromEditor(field("hero", "heading", "heading", "Typed"));
    expect(detached.querySelector("h1")!.textContent).toBe("Stored heading");
    expect(debug).toHaveBeenCalledTimes(1);
  });

  it("B5: writes into the section the post names, not another with the same field", () => {
    selectHero();
    fromEditor(field("hero", "heading", "heading", "Typed"));
    expect(heroHeading()).toBe("Typed");
    expect(document.querySelector('[data-storefront-section-id="other"] h1')!.textContent).toBe(
      "Other heading",
    );
  });

  it("sends nothing back to the editor for a refused post", () => {
    selectHero();
    const before = posted.length;
    fromEditor(field("other", "heading", "heading", "Typed"));
    expect(posted.slice(before)).toEqual([]);
  });
});
