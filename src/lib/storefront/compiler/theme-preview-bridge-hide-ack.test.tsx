// @vitest-environment jsdom
import { cleanup, render } from "@testing-library/react";
import * as React from "react";
import ts from "typescript";
import { afterEach, describe, expect, it, vi } from "vitest";
import { previewSectionSelector } from "@/lib/storefront/editor/preview-dom";
import { themePreviewBridgeEntrySource } from "./theme-preview-bridge-entry";
import { themeSectionGateSource } from "./theme-section-gate";

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
  "window",
  `${BRIDGE.slice(start, end)}\nreturn isSectionPresentationCommitted;`,
)(previewSectionSelector, document, window) as (
  sectionId: string,
  enabled: boolean,
) => boolean;

const page = (html: string) => {
  document.body.innerHTML = html;
};

afterEach(() => {
  cleanup();
  document.body.innerHTML = "";
  routeContext.current = undefined;
  // What the gates reported belongs to one document.
  const holder = window as unknown as Record<string, unknown>;
  delete holder.__morphSectionGateCommits;
  delete holder.__morphSectionGateSlots;
});

/** The gate as the workspace carries it, with a stand-in router context. */
const routeContext = { current: undefined as unknown };
function loadGate() {
  const compiled = ts.transpileModule(themeSectionGateSource(), {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
      jsx: ts.JsxEmit.ReactJSX,
    },
  }).outputText;
  const exports: Record<string, unknown> = {};
  const require = (name: string) => {
    if (name === "react") return React;
    if (name === "@tanstack/react-router") {
      return { useRouteContext: () => routeContext.current };
    }
    throw new Error(`Unexpected import ${name}`);
  };
  new Function("exports", "require", compiled)(exports, require);
  return exports as {
    MorphSectionGate: (props: { slot: string; render: () => React.ReactNode }) => React.ReactNode;
  };
}
const gate = loadGate();
const visibility = (hiddenSlots: string[]) => ({
  morphContent: { slots: {}, hiddenSlots },
});

describe("a Hide is acknowledged only once the section is gone", () => {
  it("found the check in the bridge", () => {
    expect(start).toBeGreaterThan(0);
    expect(end).toBeGreaterThan(start);
  });

  // Review of b4e81b2, N1: a section with no gate of Morph's in this document
  // (a Theme refused for Hide, a Starter 31 Theme, a section the author
  // guards) is hidden by being absent, as before the gate. Requiring a gate
  // there left the editor waiting ("Preview syncing") on a section already
  // hidden when it opened.
  it("acknowledges a Hide by absence when no gate for the section is in the document", () => {
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

// Review P2-7: no section on the page is not the same as a Hide applied.
// The route may have rendered its error state, or a Suspense fallback may be
// on screen instead of it; only a gate that committed the section as hidden
// acknowledges a Hide.
describe("a Hide is acknowledged only by a committed render that hid it", () => {
  class Boundary extends React.Component<{ children: React.ReactNode }, { failed: boolean }> {
    state = { failed: false };
    static getDerivedStateFromError() {
      return { failed: true };
    }
    render() {
      return this.state.failed ? <p>The page could not be shown.</p> : this.props.children;
    }
  }

  it("acknowledges a Hide the gate committed", () => {
    routeContext.current = visibility(["hero"]);
    render(
      <main>
        <gate.MorphSectionGate
          slot="hero"
          render={() => <div data-storefront-section-id="hero">HERO</div>}
        />
      </main>,
    );
    expect(committed("hero", false)).toBe(true);
  });

  it("does not acknowledge a Hide while the route shows its error state", () => {
    // The page rendered the section through its gate; then the hide arrives
    // and the route fails instead of rendering it.
    routeContext.current = visibility([]);
    let fail = false;
    const Broken = () => {
      if (fail) throw new Error("the route failed");
      return null;
    };
    const Page = () => (
      <Boundary>
        <main>
          <Broken />
          <gate.MorphSectionGate
            slot="hero"
            render={() => <div data-storefront-section-id="hero">HERO</div>}
          />
        </main>
      </Boundary>
    );
    const view = render(<Page />);
    expect(committed("hero", true)).toBe(true);
    routeContext.current = visibility(["hero"]);
    fail = true;
    const errors = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      view.rerender(<Page />);
    } finally {
      errors.mockRestore();
    }
    expect(document.body.textContent).toContain("could not be shown");
    expect(committed("hero", false)).toBe(false);
  });

  it("does not acknowledge a Hide while a Suspense fallback stands in for the route", () => {
    routeContext.current = visibility(["hero"]);
    const never = new Promise<never>(() => {});
    const Suspends = () => {
      throw never;
    };
    render(
      <React.Suspense fallback={<p>Loading</p>}>
        <main>
          <Suspends />
          <gate.MorphSectionGate
            slot="hero"
            render={() => <div data-storefront-section-id="hero">HERO</div>}
          />
        </main>
      </React.Suspense>,
    );
    expect(document.body.textContent).toContain("Loading");
    expect(committed("hero", false)).toBe(false);
  });
});

describe("a gated section the page does not mount (review of b4e81b2, N1)", () => {
  it("acknowledges a Hide when the gate sits in a branch the page did not take", () => {
    routeContext.current = visibility(["hero"]);
    const showPromo = false;
    render(
      <main>
        {showPromo && (
          <gate.MorphSectionGate
            slot="hero"
            render={() => <div data-storefront-section-id="hero">HERO</div>}
          />
        )}
      </main>,
    );
    expect(committed("hero", false)).toBe(true);
  });

  it("still holds a Hide while a gate for it shows it", () => {
    routeContext.current = visibility([]);
    render(
      <main>
        <gate.MorphSectionGate slot="hero" render={() => <p>no section marker</p>} />
      </main>,
    );
    expect(committed("hero", false)).toBe(false);
  });
});

