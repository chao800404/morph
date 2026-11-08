import { describe, expect, it } from "vitest";
import { normalizeDocumentRowIds } from "./normalize-row-ids";
import {
  declaredContentDefault,
  declaredUnstoredListRows,
  resolveSectionContentDeclaration,
} from "./section-content-declaration";

const ENTRIES_PATH = "src/components/Entries.tsx";
const DEFAULTS = [{ title: "One" }, { title: "Two" }];
const declared = `export const contentFields = {
  items: {
    type: "array",
    label: "Entries",
    fields: { title: { type: "text", label: "Title" } },
  },
  heading: { type: "text", label: "Heading" },
} as const;
export default function Entries({ items = ${JSON.stringify(DEFAULTS)}, heading = "Hi" }: { items?: { id?: string; title?: string }[]; heading?: string }) {
  return <section><h2>{heading}</h2>{items.map((item, index) => <h3 key={item.id ?? index}>{item.title}</h3>)}</section>;
}`;
const files = (source = declared) => [{ path: ENTRIES_PATH, content: source }];
const section = { type: "entries", componentRef: ENTRIES_PATH };
const scope = { templateId: "template-1", sectionId: "section" };

describe("declaredUnstoredListRows", () => {
  it("gives the declared default rows the ids the server derives for them", () => {
    const server = normalizeDocumentRowIds(
      { sections: [{ id: "section", props: { items: DEFAULTS } }] },
      "template-1",
    ).value.sections[0]!.props.items;

    const rows = declaredUnstoredListRows(files(), section, {
      fieldKey: "items",
      scope,
    });

    expect(rows).toEqual(server);
    expect(rows!.every((row) => String(row.id).startsWith("morph-mig-"))).toBe(
      true,
    );
  });

  it("depends on the section the rows belong to", () => {
    const here = declaredUnstoredListRows(files(), section, {
      fieldKey: "items",
      scope,
    });
    const elsewhere = declaredUnstoredListRows(files(), section, {
      fieldKey: "items",
      scope: { ...scope, sectionId: "other" },
    });
    expect(elsewhere!.map((row) => row.id)).not.toEqual(
      here!.map((row) => row.id),
    );
  });

  it("draws nothing for a field that is not a declared list", () => {
    expect(
      declaredUnstoredListRows(files(), section, {
        fieldKey: "heading",
        scope,
      }),
    ).toBeUndefined();
    expect(
      declaredUnstoredListRows(files(), section, {
        fieldKey: "missing",
        scope,
      }),
    ).toBeUndefined();
  });

  it("draws nothing when the component declares no contentFields", () => {
    const undeclared = declared.replace(
      /export const contentFields = \{[\s\S]*?\} as const;\n/,
      "",
    );
    expect(undeclared).not.toContain("contentFields");
    expect(
      declaredUnstoredListRows(files(undeclared), section, {
        fieldKey: "items",
        scope,
      }),
    ).toBeUndefined();
  });

  it("draws an empty default as empty, and nothing for a default the source does not state", () => {
    const noDefault = declared.replace(
      `items = ${JSON.stringify(DEFAULTS)}`,
      "items = []",
    );
    expect(
      declaredUnstoredListRows(files(noDefault), section, {
        fieldKey: "items",
        scope,
      }),
    ).toEqual([]);
    const computed = declared.replace(
      `items = ${JSON.stringify(DEFAULTS)}`,
      "items",
    );
    expect(
      declaredUnstoredListRows(files(computed), section, {
        fieldKey: "items",
        scope,
      }),
    ).toBeUndefined();
  });

  it("draws nothing without the workspace", () => {
    expect(
      declaredUnstoredListRows(undefined, section, {
        fieldKey: "items",
        scope,
      }),
    ).toBeUndefined();
  });
});

describe("resolveSectionContentDeclaration", () => {
  it("answers from the section's componentRef before the selected file", () => {
    const shared = "src/components/Link.tsx";
    const resolved = resolveSectionContentDeclaration(
      [...files(), { path: shared, content: "export default () => null;" }],
      {
        componentRef: ENTRIES_PATH,
        componentPath: shared,
        sectionComponentPath: ENTRIES_PATH,
      },
    );
    expect(resolved.sourcePath).toBe(ENTRIES_PATH);
    expect(Object.keys(resolved.capability?.fields ?? {})).toEqual([
      "items",
      "heading",
    ]);
  });

  it("falls back to the section's own component when the selected file declares nothing", () => {
    const shared = "src/components/Link.tsx";
    const resolved = resolveSectionContentDeclaration(
      [...files(), { path: shared, content: "export default () => null;" }],
      {
        componentRef: null,
        componentPath: shared,
        sectionComponentPath: ENTRIES_PATH,
      },
    );
    expect(resolved.sourcePath).toBe(ENTRIES_PATH);
    expect(resolved.capability).not.toBeNull();
  });
});

describe("declaredContentDefault", () => {
  const meta = {
    defaultProps: { title: "Hi" },
    defaultPropValues: { title: "Hi", size: null, items: [{ title: "One" }] },
  };

  it("keeps a default stated as null, apart from no default at all", () => {
    expect(declaredContentDefault(meta, "size")).toBeNull();
    expect(declaredContentDefault(meta, "missing")).toBeUndefined();
    expect(declaredContentDefault(null, "size")).toBeUndefined();
  });

  it("answers the structured value, else the string form", () => {
    expect(declaredContentDefault(meta, "items")).toEqual([{ title: "One" }]);
    expect(declaredContentDefault(meta, "title")).toBe("Hi");
    expect(
      declaredContentDefault(
        { defaultProps: { label: "Go" }, defaultPropValues: {} },
        "label",
      ),
    ).toBe("Go");
  });
});
