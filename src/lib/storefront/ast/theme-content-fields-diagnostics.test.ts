import { describe, expect, it } from "vitest";
import {
  collectComponentPropNames,
  collectThemeContentFieldsDiagnostics,
} from "./theme-content-fields-diagnostics";

const file = (path: string, content: string) => ({ path, content });

describe("collectComponentPropNames", () => {
  it("finds destructured props and ignores runtime-only props", () => {
    const props = collectComponentPropNames(
      `export function Hero({ title, onClick, className, badgeText }) {
        return <h1>{title}{badgeText}</h1>;
      }`,
    );
    expect([...props.keys()]).toEqual(["title", "badgeText"]);
  });

  it("reads props from a TypeScript interface reference", () => {
    const props = collectComponentPropNames(
      `interface HeroProps { heading?: string; badgeText?: string; onSelect?: () => void }
       export default function Hero(props: HeroProps) { return <div />; }`,
    );
    expect([...props.keys()]).toEqual(["heading", "badgeText"]);
  });

  it("does not infer props from an untyped runtime object", () => {
    expect(
      collectComponentPropNames(
        `export default function Hero(props) { return <div>{props.title}</div>; }`,
      ).size,
    ).toBe(0);
  });
});

describe("collectThemeContentFieldsDiagnostics", () => {
  it("warns when a content prop is missing from the allowlist", () => {
    const diagnostics = collectThemeContentFieldsDiagnostics([
      file(
        "src/components/Hero.tsx",
        `export default function Hero({ title, badgeText }) { return <div />; }`,
      ),
    ]);
    expect(diagnostics).toHaveLength(1);
    expect(diagnostics[0].message).toContain('"title"');
    expect(diagnostics[0].message).toContain('"badgeText"');
  });

  it("uses the manifest capability and stays quiet when every prop is declared", () => {
    const files = [
      file(
        "morph.theme.json",
        JSON.stringify({
          components: {
            "hero.default": {
              source: "src/components/Hero.tsx",
              contentFields: {
                title: { type: "text" },
                badgeText: { type: "text" },
              },
            },
          },
        }),
      ),
      file(
        "src/components/Hero.tsx",
        `export default function Hero({ title, badgeText }) { return <div />; }`,
      ),
    ];
    const diagnostics = collectThemeContentFieldsDiagnostics(files);
    expect(diagnostics).toEqual([]);
  });

  it("recognizes a co-located declaration without manifest registration", () => {
    const diagnostics = collectThemeContentFieldsDiagnostics([
      file(
        "src/components/Hero.tsx",
        `export const contentFields = { title: { type: "text" } } as const;
         export default function Hero({ title }) { return <div />; }`,
      ),
    ]);
    expect(diagnostics).toEqual([]);
  });

  it("does not warn for legacy literal defaults already supported by the Inspector", () => {
    const diagnostics = collectThemeContentFieldsDiagnostics([
      file(
        "src/components/Hero.tsx",
        `export default function Hero({ title = "Hello" }) { return <div />; }`,
      ),
    ]);
    expect(diagnostics).toEqual([]);
  });
});

describe("a repeated field whose map takes no index", () => {
  const component = (map: string) => [
    {
      path: "morph.theme.json",
      content: JSON.stringify({
        components: { "nav.default": { source: "src/components/Nav.tsx" } },
      }),
    },
    {
      path: "src/components/Nav.tsx",
      content: `import type { ThemeContentFields } from "../morph/content-fields";

export const contentFields = {
  navItems: {
    type: "array",
    label: "Navigation",
    fields: { label: { type: "text" } },
  },
} as const satisfies ThemeContentFields;

export default function Nav({ navItems = [] }) {
  return <nav>{${map}}</nav>;
}
`,
    },
  ];

  const indexDiagnostics = (map: string) =>
    collectThemeContentFieldsDiagnostics(component(map)).filter((entry) =>
      entry.id.startsWith("content-array-index:"),
    );

  /**
   * TypeScript accepts this — a callback may always take fewer parameters than
   * the signature offers — so the compiler cannot refuse it and says so here
   * instead. The rows it produces share one source position and carry no field
   * path, and the editor drops them rather than write one row into another.
   */
  it("is reported, because a type error is not available", () => {
    const [diagnostic, ...rest] = indexDiagnostics(
      "navItems.map((item) => <span key={item.label}>{item.label}</span>)",
    );
    expect(rest).toEqual([]);
    expect(diagnostic?.message).toContain('"navItems"');
    expect(diagnostic?.message).toContain("(item, index)");
    expect(diagnostic?.severity).toBe("warning");
    // On the `map` itself, which is what has to change.
    expect(diagnostic?.line).toBe(12);
  });

  it("says nothing once the callback takes one", () => {
    expect(
      indexDiagnostics(
        "navItems.map((item, index) => <span key={index}>{item.label}</span>)",
      ),
    ).toEqual([]);
  });

  // The name is not the point; having a second parameter is.
  it("accepts any name for it", () => {
    expect(
      indexDiagnostics(
        "navItems.map((item, idx) => <span key={idx}>{item.label}</span>)",
      ),
    ).toEqual([]);
  });

  // Only a declared repeated field is addressed by row, so only those rows are
  // lost. An ordinary array in a component's own code is not the editor's.
  it("leaves a map over something that is not a content field alone", () => {
    const files = component(
      "[1, 2, 3].map((value) => <span key={value}>{value}</span>)",
    );
    expect(
      collectThemeContentFieldsDiagnostics(files).filter((entry) =>
        entry.id.startsWith("content-array-index:"),
      ),
    ).toEqual([]);
  });
});
