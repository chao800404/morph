import { act, cleanup, render } from "@testing-library/react";
import * as React from "react";
import { renderToString } from "react-dom/server";
import ts from "typescript";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  THEME_SECTION_GATE_MODULE,
  THEME_SECTION_GATE_PATH,
  themeSectionGateSource,
} from "./theme-section-gate";
import { THEME_MORPH_SDK_MODULES, themeMorphSdkFiles } from "./theme-morph-sdk";

/**
 * M3 Hide approach E: the platform's section gate, the component Morph's
 * compiled guard mounts around every section it can hide.
 *
 * Executes the actual gate source the workspace carries, with React and a
 * stand-in for the router's `useRouteContext`, which answers what the root
 * route's `beforeLoad` put in the route context (`morphContent`).
 */

type Gate = Readonly<{
  MorphSectionGate: (props: { slot: string; render: () => React.ReactNode }) => React.ReactNode;
  MorphPageSectionGate: (props: {
    slot: string;
    hidden: unknown;
    render: () => React.ReactNode;
  }) => React.ReactNode;
  MorphSectionVisibilityError: new (...args: never[]) => Error;
}>;

const routeContext = { current: undefined as unknown };

function loadGate(): Gate {
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
      return {
        useRouteContext: (options: { from?: string }) => {
          expect(options.from).toBe("__root__");
          return routeContext.current;
        },
      };
    }
    throw new Error(`Unexpected import ${name}`);
  };
  new Function("exports", "require", compiled)(exports, require);
  return exports as unknown as Gate;
}

const gate = loadGate();
const visibility = (hiddenSlots: unknown) => ({
  morphContent: { slots: {}, hiddenSlots },
});

afterEach(() => {
  cleanup();
  routeContext.current = undefined;
});

describe("the platform carries the gate", () => {
  it("in every Start workspace, under its own name", () => {
    expect(THEME_MORPH_SDK_MODULES[THEME_SECTION_GATE_MODULE]).toBe(
      THEME_SECTION_GATE_PATH,
    );
    expect(
      themeMorphSdkFiles().find((file) => file.path === THEME_SECTION_GATE_PATH)
        ?.content,
    ).toBe(themeSectionGateSource());
  });
});

describe("MorphSectionGate: visibility from the root route's snapshot", () => {
  it("renders the section when it is not hidden", () => {
    routeContext.current = visibility(["other"]);
    const html = renderToString(
      <gate.MorphSectionGate slot="hero" render={() => <section>HERO</section>} />,
    );
    expect(html).toBe("<section>HERO</section>");
  });

  it("renders nothing for a hidden section, and never builds its props", () => {
    routeContext.current = visibility(["hero"]);
    const renderSection = vi.fn(() => <section>HERO-DEFAULT</section>);
    const html = renderToString(
      <gate.MorphSectionGate slot="hero" render={renderSection} />,
    );
    expect(html).toBe("");
    expect(renderSection).not.toHaveBeenCalled();
  });

  it.each([
    ["no route context", undefined],
    ["no morphContent", {}],
    ["no hidden list", { morphContent: { slots: {} } }],
    ["a hidden list that is not an array", visibility("hero")],
    ["a hidden list with a non-string", visibility(["other", 7])],
  ])("refuses to render with %s, rather than showing the section", (_, context) => {
    routeContext.current = context;
    const renderSection = vi.fn(() => <section>HERO-DEFAULT</section>);
    expect(() =>
      renderToString(<gate.MorphSectionGate slot="hero" render={renderSection} />),
    ).toThrow(gate.MorphSectionVisibilityError);
    expect(renderSection).not.toHaveBeenCalled();
  });

  it("keeps the section's own hooks stable as it is hidden and shown without a reload", () => {
    function Counter() {
      const [count, setCount] = React.useState(0);
      return (
        <button type="button" onClick={() => setCount(count + 1)}>
          count {count}
        </button>
      );
    }
    // The section's props are built inside the gate's body, which is mounted
    // only while visible: a hook called while building them (the Starter's
    // `content()`) is called on every render of that body, never
    // conditionally inside the route's own render.
    const readsContext = vi.fn(() => React.useContext(React.createContext("ctx")));
    const Page = () => (
      <main>
        <gate.MorphSectionGate
          slot="hero"
          render={() => {
            readsContext();
            return <Counter />;
          }}
        />
      </main>
    );
    const errors = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      routeContext.current = visibility([]);
      const view = render(<Page />);
      expect(view.container.textContent).toBe("count 0");
      act(() => view.container.querySelector("button")!.click());
      expect(view.container.textContent).toBe("count 1");

      routeContext.current = visibility(["hero"]);
      view.rerender(<Page />);
      expect(view.container.textContent).toBe("");

      routeContext.current = visibility([]);
      view.rerender(<Page />);
      expect(view.container.textContent).toBe("count 0");
      expect(errors).not.toHaveBeenCalled();
    } finally {
      errors.mockRestore();
    }
  });
});

describe("MorphPageSectionGate: visibility from the page the slot came from", () => {
  it("renders the section unless the page lists it hidden", () => {
    expect(
      renderToString(
        <gate.MorphPageSectionGate
          slot="hero"
          hidden={["other"]}
          render={() => <section>HERO</section>}
        />,
      ),
    ).toBe("<section>HERO</section>");
    const renderSection = vi.fn(() => <section>HERO</section>);
    expect(
      renderToString(
        <gate.MorphPageSectionGate slot="hero" hidden={["hero"]} render={renderSection} />,
      ),
    ).toBe("");
    expect(renderSection).not.toHaveBeenCalled();
  });

  it.each([
    ["no hidden list", undefined],
    ["a hidden list that is not an array", "hero"],
    ["a hidden list with a non-string", [1]],
  ])("refuses to render with %s", (_, hidden) => {
    const renderSection = vi.fn(() => <section>HERO</section>);
    expect(() =>
      renderToString(
        <gate.MorphPageSectionGate slot="hero" hidden={hidden} render={renderSection} />,
      ),
    ).toThrow(gate.MorphSectionVisibilityError);
    expect(renderSection).not.toHaveBeenCalled();
  });
});
