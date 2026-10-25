import { parse } from "@babel/parser";
import { describe, expect, it } from "vitest";
import { patchStringLiteralAt, resolveSourceDefaultNode } from "./source-default-node";

const path = "src/components/Probe.tsx";
const resolve = (content: string, componentName?: string) =>
  resolveSourceDefaultNode({
    files: [{ path, content }],
    componentSourcePath: path,
    fieldKey: "title",
    componentName,
  });

type TitleDefault = { value: string; start: number; end: number; type: string };

const ast = (source: string) =>
  parse(source, { sourceType: "module", plugins: ["typescript", "jsx"] });

/** Every `title = "..."` default in the file, in source order. */
const titleDefaults = (source: string): TitleDefault[] => {
  const found: TitleDefault[] = [];
  const walk = (node: any) => {
    if (!node || typeof node !== "object") return;
    if (Array.isArray(node)) {
      for (const child of node) walk(child);
      return;
    }
    if (
      node.type === "AssignmentPattern" &&
      node.left?.type === "Identifier" &&
      node.left.name === "title" &&
      typeof node.right?.start === "number"
    ) {
      found.push({
        value: node.right.value,
        start: node.right.start,
        end: node.right.end,
        type: node.right.type,
      });
    }
    for (const child of Object.values(node)) walk(child);
  };
  walk(ast(source).program);
  return found;
};

const FORMS: Array<[string, string, string | undefined]> = [
  [
    "named function",
    'export function Hero({ title = "Named" }: { title?: string }) { return <h1>{title}</h1>; }',
    "Hero",
  ],
  [
    "arrow component",
    'export const Hero = ({ title = "Arrow" }: { title?: string }) => <h1>{title}</h1>;',
    "Hero",
  ],
  [
    "anonymous default",
    'export default function ({ title = "Anon" }: { title?: string }) { return <h1>{title}</h1>; }',
    undefined,
  ],
  [
    "export alias",
    'function Hero({ title = "Alias" }: { title?: string }) { return <h1>{title}</h1>; }\nexport { Hero as Card };',
    "Card",
  ],
  [
    "multiple components, named",
    'export function Hero({ title = "One" }) { return <h1>{title}</h1>; }\nexport function Card({ title = "Two" }) { return <p>{title}</p>; }',
    "Card",
  ],
];

describe("precise default node", () => {
  for (const [name, source, componentName] of FORMS) {
    it(`resolves ${name}`, () => {
      const result = resolve(source, componentName);
      expect(result.status).toBe("default");
      if (result.status !== "default") return;
      expect(result.value.length).toBeGreaterThan(0);
      expect(source.slice(result.target.start, result.target.end)).toContain(
        result.value,
      );
      const atTarget = titleDefaults(source).find(
        (entry) => entry.start === result.target.start,
      );
      expect(atTarget?.value).toBe(result.value);
    });
  }

  it("rejects multiple same-named defaults without a component identity", () => {
    const source =
      'export function Hero({ title = "One" }) { return <h1>{title}</h1>; }\nexport function Card({ title = "Two" }) { return <p>{title}</p>; }';
    expect(resolve(source).status).toBe("ambiguous");
  });

  it("patches only the target range, keeping the other component untouched", () => {
    const source =
      'export function Hero({ title = "One" }) { return <h1>{title}</h1>; }\nexport function Card({ title = "Two" }) { return <p>{title}</p>; }';
    const result = resolve(source, "Card");
    expect(result.status).toBe("default");
    if (result.status !== "default") return;
    const next = patchStringLiteralAt(source, result.target, "New");
    expect(next.slice(0, result.target.start)).toBe(
      source.slice(0, result.target.start),
    );
    expect(next.slice(next.length - (source.length - result.target.end))).toBe(
      source.slice(result.target.end),
    );
    expect(titleDefaults(next).map((entry) => entry.value)).toEqual([
      "One",
      "New",
    ]);
  });

  it("writes a safe literal before CJK and emoji", () => {
    const source =
      'const label = "中文🙂";\nconst Hero = ({ title = "Old" }) => <h1>{title}</h1>;';
    const result = resolve(source, "Hero");
    expect(result.status).toBe("default");
    if (result.status !== "default") return;
    const next = patchStringLiteralAt(source, result.target, "New");
    expect(next.slice(0, result.target.start)).toBe(
      source.slice(0, result.target.start),
    );
    expect(titleDefaults(next)[0]?.value).toBe("New");
  });

  it("keeps quotes, interpolation and newlines inert", () => {
    const source = 'const Hero = ({ title = "Old" }) => <h1>{title}</h1>;';
    const result = resolve(source, "Hero");
    expect(result.status).toBe("default");
    if (result.status !== "default") return;
    const newValue = 'a"b`${c}\nd';
    const next = patchStringLiteralAt(source, result.target, newValue);
    const atTarget = titleDefaults(next).find(
      (entry) => entry.start === result.target.start,
    );
    expect(atTarget?.type).toBe("StringLiteral");
    expect(atTarget?.value).toBe(newValue);
    expect(next.slice(0, result.target.start)).toBe(
      source.slice(0, result.target.start),
    );
    expect(next.slice(next.length - (source.length - result.target.end))).toBe(
      source.slice(result.target.end),
    );
  });
});
