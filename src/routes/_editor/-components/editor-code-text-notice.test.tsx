import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { EditorSelectionDescriptor } from "@/lib/storefront/editor/selection-taxonomy";
import { EditorStyleInspector } from "./editor-style-inspector";
import { EditorCodeTextNotice } from "./editor-code-text-notice";
import type { TextPromotionAnalysis } from "@/lib/storefront/editor/text-promotion";
import type { TextPromotionOutcome } from "@/lib/storefront/editor/text-promotion-request";

const SECTION = "src/components/sections/Promo.tsx";
const ROUTE = "src/routes/index.tsx";

const file = (path: string, content: string) => ({
  id: path,
  storefrontId: "storefront-1",
  themeId: "theme-1",
  path,
  content,
  mimeType: "text/typescript",
  isEntry: false,
  version: 1,
  createdAt: "2026-09-25T00:00:00.000Z",
  updatedAt: "2026-09-25T00:00:00.000Z",
});

const files = (component: string) => [
  file(
    "src/morph/content.ts",
    "export function content(slot: string) { return {}; }\n",
  ),
  file(
    ROUTE,
    `import { content } from "../morph/content";
import Promo from "../components/sections/Promo";
export default function Home() {
  return <main><Promo {...content("promo")} /></main>;
}
`,
  ),
  file(SECTION, component),
];

const selection = (
  line: number,
  column: number,
): EditorSelectionDescriptor => ({
  sectionId: "promo",
  kind: "paragraph",
  componentType: "promo",
  tagName: "p",
  role: null,
  inputType: null,
  nodeId: null,
  sourceFilePath: SECTION,
  sourceLocation: `${SECTION}:${line}:${column}`,
  elementKey: null,
  fieldKey: null,
  fieldPath: null,
  className: "",
  isSection: false,
  computed: null,
  parentComputed: null,
  sectionComputed: null,
  inspectorOverride: null,
});

function renderInspector(component: string, line: number, column: number) {
  return render(
    <EditorStyleInspector
      view="content"
      section={{
        id: "promo",
        type: "promo",
        componentRef: SECTION,
        enabled: true,
        props: {},
      }}
      themeFiles={files(component) as never}
      routeSourcePath={ROUTE}
      selection={selection(line, column)}
      onPropsChange={vi.fn()}
      onUpdateThemeFileStyle={vi.fn()}
      onJumpToCode={vi.fn()}
    />,
  );
}

describe("Content tab on text written in code", () => {
  it("says fixed text could become a field, and offers nothing to click", () => {
    renderInspector(
      `export default function Promo({}) {
  return (
    <p>hello world</p>
  );
}
`,
      3,
      5,
    );
    const notice = screen.getByTestId("editor-code-text-notice");
    expect(notice.dataset.status).toBe("convertible");
    expect(notice.textContent).toContain("hello world");
    expect(notice.textContent).toContain("can become a field");
    expect(notice.querySelector("button")).toBeNull();
    expect(
      screen.queryByText("This element has no editable content."),
    ).toBeNull();
  });

  it("says why text can only be edited in Code", () => {
    renderInspector(
      `export default function Promo({ items = [] }) {
  return <ul>{items.map((item) => <li key={item}>Fixed</li>)}</ul>;
}
`,
      2,
      35,
    );
    const notice = screen.getByTestId("editor-code-text-notice");
    expect(notice.dataset.status).toBe("code-only");
    expect(notice.textContent).toContain("Edit it in Code.");
    expect(notice.textContent).toContain("once per item of a list");
  });

  // Found by the e2e: a section declaring any field counted every element in
  // it as editable, so fixed text got an empty field list and no notice.
  it("describes fixed text in a section that declares other fields", () => {
    renderInspector(
      `export const contentFields = {
  heading: { type: "text", label: "Heading" },
} as const;
export default function Promo({ heading = "Hi" }) {
  return (
    <div><h2>{heading}</h2>
    <p>Fixed line</p></div>
  );
}
`,
      7,
      5,
    );
    const notice = screen.getByTestId("editor-code-text-notice");
    expect(notice.dataset.status).toBe("convertible");
    expect(notice.textContent).toContain("Fixed line");
  });

  it("keeps the empty state for an element with no text of its own", () => {
    renderInspector(
      `export default function Promo({}) {
  return (
    <div><p>one</p><p>two</p></div>
  );
}
`,
      3,
      5,
    );
    expect(screen.queryByTestId("editor-code-text-notice")).toBeNull();
    expect(
      screen.getByText("This element has no editable content."),
    ).toBeTruthy();
  });
});

describe("making code text editable", () => {
  const analysis = (
    scope: "route" | "layout" = "route",
  ): TextPromotionAnalysis => ({
    status: "convertible",
    text: "hello world",
    tag: "p",
    suggestedName: "text",
    reservedNames: ["eyebrow"],
    fieldDeclaration: "inferred",
    callSite: { path: ROUTE, scope },
  });

  function renderNotice(
    outcome: TextPromotionOutcome,
    options: { scope?: "route" | "layout" } = {},
  ) {
    const onPromote = vi.fn(async () => outcome);
    const onCreatePageCopy = vi.fn(async () => ({ success: true }));
    render(
      <EditorCodeTextNotice
        analysis={analysis(options.scope)}
        sectionId="promo"
        componentSourcePath={SECTION}
        targetKey="3:5"
        onPromote={onPromote}
        onCreatePageCopy={onCreatePageCopy}
      />,
    );
    return { onPromote, onCreatePageCopy };
  }

  it("sends the edited text under the confirmed name", async () => {
    const { onPromote } = renderNotice({
      status: "promoted",
      fieldName: "intro",
    });
    fireEvent.change(screen.getByDisplayValue("hello world"), {
      target: { value: "Hello there" },
    });
    fireEvent.change(screen.getByDisplayValue("text"), {
      target: { value: "intro" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Make editable" }));
    await waitFor(() =>
      expect(onPromote).toHaveBeenCalledWith({
        sectionId: "promo",
        componentSourcePath: SECTION,
        targetKey: "3:5",
        fieldName: "intro",
        value: "Hello there",
        confirmedImpact: undefined,
      }),
    );
  });

  it("will not send a name the component uses or that is not an identifier", () => {
    const { onPromote } = renderNotice({ status: "promoted", fieldName: "x" });
    const name = screen.getByDisplayValue("text");
    const button = screen.getByRole("button", { name: "Make editable" });

    fireEvent.change(name, { target: { value: "eyebrow" } });
    expect(
      screen.getByText("The component already uses this name."),
    ).toBeTruthy();
    expect((button as HTMLButtonElement).disabled).toBe(true);

    fireEvent.change(name, { target: { value: "2nd" } });
    expect(
      screen.getByText("Use letters and digits, starting with a letter."),
    ).toBeTruthy();
    fireEvent.click(button);
    expect(onPromote).not.toHaveBeenCalled();
  });

  it("offers a page copy first when the component is shared", async () => {
    const impact = ["src/routes/about.tsx"];
    const { onPromote, onCreatePageCopy } = renderNotice({
      status: "shared",
      impact,
    });
    fireEvent.click(screen.getByRole("button", { name: "Make editable" }));
    const shared = await screen.findByTestId("editor-code-text-shared");
    expect(shared.textContent).toContain("src/routes/about.tsx");

    fireEvent.click(screen.getByRole("button", { name: "Create page copy" }));
    await waitFor(() => expect(onCreatePageCopy).toHaveBeenCalledWith("promo"));
    expect(
      await screen.findByText(/Created a copy for this page/),
    ).toBeTruthy();
    expect(onPromote).toHaveBeenCalledTimes(1);
  });

  it("changes the shared component only with the list it was shown", async () => {
    const impact = ["src/routes/about.tsx"];
    const { onPromote } = renderNotice({ status: "shared", impact });
    fireEvent.click(screen.getByRole("button", { name: "Make editable" }));
    fireEvent.click(
      await screen.findByRole("button", { name: "Change shared component" }),
    );
    await waitFor(() =>
      expect(onPromote).toHaveBeenLastCalledWith(
        expect.objectContaining({ confirmedImpact: impact }),
      ),
    );
  });

  it("offers no page copy for a layout section", async () => {
    renderNotice({ status: "shared", impact: ["x"] }, { scope: "layout" });
    fireEvent.click(screen.getByRole("button", { name: "Make editable" }));
    await screen.findByTestId("editor-code-text-shared");
    expect(
      screen.queryByRole("button", { name: "Create page copy" }),
    ).toBeNull();
  });

  it("says why the server refused", async () => {
    renderNotice({
      status: "failed",
      message: "The component changed since this page was loaded.",
    });
    fireEvent.click(screen.getByRole("button", { name: "Make editable" }));
    expect((await screen.findByRole("alert")).textContent).toBe(
      "The component changed since this page was loaded.",
    );
  });
});
