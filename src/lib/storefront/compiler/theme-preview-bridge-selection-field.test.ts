// @vitest-environment jsdom
import { parse } from "@babel/parser";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  previewSectionSelector,
  selectionFieldRefusal,
} from "@/lib/storefront/editor/preview-dom";
import { PREVIEW_CAPABILITIES } from "@/lib/storefront/editor/preview-protocol";
import { themePreviewBridgeEntrySource } from "./theme-preview-bridge-entry";
import { themePreviewContentModuleSource } from "./theme-preview-content";

/**
 * The Theme bridge's `update-selection-field` block, against a real DOM.
 *
 * The message names the section it is for. The frame applies it only to that
 * section, and only while that section is the one the frame has selected, is
 * still on the page as the element found for its id, and is not hidden. In
 * every other case it writes nothing, says nothing back to the editor, and
 * logs a bounded line for whoever opens the frame's console.
 *
 * The block and `reportReady` are cut out of the bridge source the preview
 * actually runs (as in `theme-preview-bridge-entry.test.ts`); the content
 * module's real `previewSlotHidden` reads a stand-in content object, and the
 * refusal rule is the shared one in `preview-dom.ts`.
 */

// jsdom has no `CSS.escape`; the ids here need no escaping, only a function.
if (typeof globalThis.CSS?.escape !== "function") {
  (globalThis as { CSS?: unknown }).CSS = {
    escape: (value: string) => value.replace(/(["\\])/g, "\\$1"),
  };
}

const BRIDGE = themePreviewBridgeEntrySource();
type Node = { type?: string; start?: number; end?: number } & Record<string, unknown>;

function cut(match: (node: Node) => boolean, pick: (node: Node) => Node): string {
  const ast = parse(BRIDGE, { sourceType: "module", plugins: ["typescript"] });
  let found: string | null = null;
  const visit = (value: unknown) => {
    if (!value || typeof value !== "object") return;
    if (Array.isArray(value)) {
      value.forEach(visit);
      return;
    }
    const node = value as Node;
    if (match(node)) {
      const picked = pick(node);
      found = BRIDGE.slice(picked.start, picked.end);
    }
    for (const [key, child] of Object.entries(node)) {
      if (key !== "loc" && key !== "extra") visit(child);
    }
  };
  visit(ast.program);
  expect(found, "the part of the bridge this test runs").not.toBeNull();
  return found!;
}

const selectionFieldBlock = () =>
  cut(
    (node) =>
      node.type === "IfStatement" &&
      !!node.test &&
      BRIDGE.slice((node.test as Node).start, (node.test as Node).end).includes(
        '"morph:storefront-preview-update-selection-field"',
      ),
    (node) => node.consequent as Node,
  );

function contentHiddenCheck(): string {
  const source = themePreviewContentModuleSource();
  const start = source.indexOf("export function previewSlotHidden");
  const end = source.indexOf("\n}\n", start);
  return source
    .slice(start, end + 2)
    .replace("export function previewSlotHidden", "function previewSlotHidden");
}

let hero: HTMLElement;
let other: HTMLElement;

beforeEach(() => {
  document.body.innerHTML = `
    <section data-storefront-section-id="hero">
      <h1 data-storefront-field-path="heading">Stored heading</h1>
      <img data-storefront-field-path="image" src="/stored.jpg" alt="Stored alt" />
      <a data-storefront-field-path="link" href="/stored">Link</a>
    </section>
    <section data-storefront-section-id="other">
      <h1 data-storefront-field-path="heading">Other heading</h1>
      <img data-storefront-field-path="image" src="/other.jpg" alt="Other alt" />
    </section>`;
  hero = document.querySelector('[data-storefront-section-id="hero"]')!;
  other = document.querySelector('[data-storefront-section-id="other"]')!;
});

afterEach(() => {
  document.body.innerHTML = "";
});

type Selected = { sectionId: string; section: Element; element: Element; fieldKey: string };

function frame(selected: Selected | null, hiddenSlots: string[] = []) {
  const content = { slots: {} as Record<string, unknown>, hiddenSlots };
  const updatePreviewContent = vi.fn();
  const refused = vi.fn();
  const drawOverlays = vi.fn();
  const handle = new Function(
    "selectedItem",
    "content",
    "document",
    "CSS",
    "drawOverlays",
    "updatePreviewContent",
    "previewSlotContent",
    "setFieldPathValue",
    "refreshPreviewContent",
    "selectionFieldRefusal",
    "previewSectionSelector",
    "logSelectionFieldRefusal",
    `${contentHiddenCheck()}
    function currentPreviewContent() { return content; }
    return (message) => ${selectionFieldBlock()};`,
  )(
    selected,
    content,
    document,
    CSS,
    drawOverlays,
    updatePreviewContent,
    () => ({}),
    (slot: Record<string, unknown>, path: string, value: unknown) => ({ ...slot, [path]: value }),
    vi.fn(),
    selectionFieldRefusal,
    previewSectionSelector,
    refused,
  ) as (message: Record<string, unknown>) => void;
  const post = (sectionId: string, fieldKey: string, fieldPath: string, value: string) =>
    handle({
      type: "morph:storefront-preview-update-selection-field",
      sectionId,
      fieldKey,
      fieldPath,
      value,
    });
  return { post, updatePreviewContent, refused, drawOverlays };
}

const heroImage = () => hero.querySelector("img")!;
const heroLink = () => hero.querySelector("a")!;
const heroSelected = (): Selected => ({
  sectionId: "hero",
  section: hero,
  element: hero.querySelector("h1")!,
  fieldKey: "heading",
});
const untouched = () => {
  expect(heroImage().getAttribute("src")).toBe("/stored.jpg");
  expect(heroImage().getAttribute("alt")).toBe("Stored alt");
  expect(heroLink().getAttribute("href")).toBe("/stored");
  expect(other.querySelector("img")!.getAttribute("src")).toBe("/other.jpg");
};

describe("the bridge applies a selection-field post to the section it names", () => {
  it("B1: applies it to the selected, visible section on the page", () => {
    const { post, updatePreviewContent, refused } = frame(heroSelected());
    post("hero", "imageSrc", "image", "/posted.jpg");
    post("hero", "actionHref", "link", "/posted");
    post("hero", "heading", "heading", "Typed");
    expect(heroImage().getAttribute("src")).toBe("/posted.jpg");
    expect(heroLink().getAttribute("href")).toBe("/posted");
    expect(updatePreviewContent).toHaveBeenCalledTimes(1);
    expect(refused).not.toHaveBeenCalled();
  });

  it("B2: writes nothing for a section other than the one selected", () => {
    const { post, updatePreviewContent, refused } = frame(heroSelected());
    post("other", "imageSrc", "image", "/posted.jpg");
    post("other", "heading", "heading", "Typed");
    untouched();
    expect(updatePreviewContent).not.toHaveBeenCalled();
    expect(refused).toHaveBeenCalledTimes(2);
  });

  it("B2: writes nothing for another id that finds the selected element too", () => {
    // One element can answer to more than one id (a bound section that is
    // also an authored `data-morph-section`): the post must name the id the
    // frame selected it by, not any id that happens to find it.
    hero.setAttribute("data-morph-section", "alias");
    const { post, updatePreviewContent, refused } = frame(heroSelected());
    post("alias", "imageSrc", "image", "/posted.jpg");
    post("alias", "heading", "heading", "Typed");
    untouched();
    expect(updatePreviewContent).not.toHaveBeenCalled();
    expect(refused).toHaveBeenCalledTimes(2);
  });

  it("B3: writes nothing for a hidden section", () => {
    const { post, updatePreviewContent } = frame(heroSelected(), ["hero"]);
    post("hero", "imageSrc", "image", "/posted.jpg");
    post("hero", "heading", "heading", "Typed");
    untouched();
    expect(updatePreviewContent).not.toHaveBeenCalled();
  });

  it("B4: writes nothing once the selected section has left the page", () => {
    const selected = heroSelected();
    const { post, updatePreviewContent, refused } = frame(selected);
    hero.remove();
    post("hero", "imageSrc", "image", "/posted.jpg");
    post("hero", "heading", "heading", "Typed");
    expect(heroImage().getAttribute("src")).toBe("/stored.jpg");
    expect(updatePreviewContent).not.toHaveBeenCalled();
    expect(refused).toHaveBeenCalledTimes(2);
  });

  it("B4: writes nothing when the element found for the id is not the selected one", () => {
    // The page rendered the section again: the id now finds a new element,
    // and the one the frame selected is a stale copy still in the tree.
    const replacement = hero.cloneNode(true) as HTMLElement;
    hero.parentNode!.insertBefore(replacement, hero);
    const { post, updatePreviewContent, refused } = frame(heroSelected());
    post("hero", "imageSrc", "image", "/posted.jpg");
    post("hero", "heading", "heading", "Typed");
    expect(heroImage().getAttribute("src")).toBe("/stored.jpg");
    expect(replacement.querySelector("img")!.getAttribute("src")).toBe("/stored.jpg");
    expect(updatePreviewContent).not.toHaveBeenCalled();
    expect(refused).toHaveBeenCalledTimes(2);
  });

  it("B4: writes nothing with nothing selected", () => {
    const { post, updatePreviewContent, refused } = frame(null);
    post("hero", "heading", "heading", "Typed");
    expect(updatePreviewContent).not.toHaveBeenCalled();
    expect(refused).toHaveBeenCalledTimes(1);
  });

  it("B5: writes typed text under the section the message names", () => {
    const { post, updatePreviewContent } = frame(heroSelected());
    post("hero", "heading", "heading", "Typed");
    expect(updatePreviewContent).toHaveBeenCalledWith("hero", { heading: "Typed" });
  });
});

describe("the bridge says on ready that it reads the section a selection-field post names", () => {
  it("B6: ready carries the selection-field-section capability", () => {
    const reportReady = cut(
      (node) =>
        node.type === "FunctionDeclaration" &&
        (node.id as Node | undefined)?.name === "reportReady",
      (node) => node,
    );
    const posted: unknown[] = [];
    new Function(
      "channel",
      "servedInstanceReport",
      "postPreviewToEditorMessage",
      "reportStructure",
      "window",
      "BRIDGE_CAPABILITIES",
      `${reportReady}; reportReady();`,
    )(
      { targetOrigin: "http://localhost:3000", previewSession: "s" },
      () => null,
      (message: unknown) => posted.push(message),
      () => {},
      { dispatchEvent: () => true },
      PREVIEW_CAPABILITIES,
    );
    expect(posted).toEqual([
      {
        type: "morph:storefront-preview-ready",
        capabilities: [...PREVIEW_CAPABILITIES],
      },
    ]);
  });
});
