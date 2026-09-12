// @vitest-environment node
import { describe, expect, it } from "vitest";
import { prepareThemeSandboxWorkspace } from "./theme-sandbox-workspace";
import { DEFAULT_APPROVED_DEPENDENCIES } from "./sandbox-vite-theme-build-runner.types";

const CARD = `import type { ThemeContentFields } from "../morph/content-fields";

export const contentFields = {
  heading: { type: "text", label: "Heading" },
  items: {
    type: "array",
    label: "Items",
    fields: { title: { type: "text", label: "Title" } },
  },
} as const satisfies ThemeContentFields;

export default function Card({ heading, items = [] }) {
  return (
    <section>
      <h1>{heading}</h1>
      {items.map((item, index) => (
        <p key={item.id}>{item.title}</p>
      ))}
    </section>
  );
}
`;

const prepare = async (mode: "build" | "preview-server") => {
  const written = new Map<string, string>();
  const result = await prepareThemeSandboxWorkspace({
    session: {
      async mkdir() {},
      async writeFile(path, content) {
        written.set(path, String(content));
      },
    },
    files: [
      { path: "src/components/Card.tsx", content: CARD },
      {
        path: "src/pages/index.tsx",
        content: `import Card from "../components/Card";\nexport default () => <Card />;\n`,
      },
    ],
    entry: "src/pages/index.tsx",
    buildId: "workspace-test",
    approvedDependencies: new Set(DEFAULT_APPROVED_DEPENDENCIES),
    mode,
  });
  return {
    result,
    card: written.get("/workspace/src/components/Card.tsx") ?? "",
  };
};

describe("laying out the workspace a Theme is served from", () => {
  it("keeps a repeated row addressable even though the declaration is lifted", async () => {
    // The two passes disagree if they run the other way round: lifting the
    // declaration first leaves nothing exported to read, every row field is
    // judged undeclared, and nothing repeated stays editable.
    const { card, result } = await prepare("preview-server");

    expect(card).toContain(
      "data-storefront-field-path={`items.${index}.title`}",
    );
    expect(card).toContain('data-storefront-field="title"');
    expect(card).toContain("data-storefront-item-id={item?.id}");

    // And the lift still happened, so the module is a Fast Refresh boundary.
    expect(card).not.toContain("export const contentFields");
    expect(card).toContain("const contentFields = {");
    expect(result.ok && result.hoistedContentFields).toContain(
      "src/components/Card.tsx",
    );
  });

  it("records where each annotated element sits in the author's own file", async () => {
    const { card } = await prepare("preview-server");
    // Derived from the author's own file rather than hardcoded, because that
    // is exactly the claim: the position survives the lift, which blanks its
    // keyword in place rather than moving a byte.
    const lines = CARD.split("\n");
    const line = lines.findIndex((text) => text.includes("<h1>")) + 1;
    const column = lines[line - 1]!.indexOf("<h1>") + 2;
    expect(card).toContain(
      `data-morph-loc="src/components/Card.tsx:${line}:${column}"`,
    );
  });

  it("names the top-level field an element shows", async () => {
    const { card } = await prepare("preview-server");
    expect(card).toContain('data-storefront-field="heading"');
  });

  it("leaves a build with the Theme exactly as the author wrote it", async () => {
    const { card, result } = await prepare("build");

    expect(card).toBe(CARD);
    expect(card).toContain("export const contentFields");
    expect(card).not.toContain("data-morph-loc");
    expect(card).not.toContain("data-storefront-field");
    expect(result.ok && result.hoistedContentFields).toEqual([]);
    expect(result.ok && result.annotatedElements).toEqual({});
  });
});
