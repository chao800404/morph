import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { EditorSelectionDescriptor } from "@/lib/storefront/editor/selection-taxonomy";
import { EditorStyleInspector } from "./editor-style-inspector";

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
