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
