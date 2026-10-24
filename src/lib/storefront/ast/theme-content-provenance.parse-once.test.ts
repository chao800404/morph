// @vitest-environment node
import { describe, expect, it, vi } from "vitest";

const parserState = vi.hoisted(() => ({ calls: [] as string[] }));

vi.mock("@babel/parser", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@babel/parser")>();
  return {
    ...actual,
    parse: (source: string, options: Parameters<typeof actual.parse>[1]) => {
      parserState.calls.push(source);
      return actual.parse(source, options);
    },
  };
});

import { analyzeB1Route } from "./theme-content-provenance";
import { injectPreviewBindings } from "./inject-preview-bindings";
import { deriveThemeRouteSections } from "../compiler/theme-route-sections";

const operationFiles = () => {
  const route = `import { createFileRoute } from "@tanstack/react-router";
import { getPage } from "../server/get-page";
import Hero from "../components/Hero";
export const Route = createFileRoute("/")({ loader: () => getPage(), component: Home });
function Home() { const { hero } = Route.useLoaderData(); return <Hero {...hero} />; }
/* B1_PARSE_ONCE_ROUTE */`;
  const hero = `export const contentFields = { title: { type: "text" } } as const;
export default function Hero({ title }: { title?: string }) { return <h1>{title}</h1>; }
/* B1_PARSE_ONCE_COMPONENT */`;
  const server = `import { createServerFn } from "@tanstack/react-start";
import { morph } from "../morph/content";
export const getPage = createServerFn().handler(() => morph.pages.get("/"));
/* B1_PARSE_ONCE_SERVER */`;
  const content = `export const morph = { pages: { get(path: string) { return path; } } };
/* B1_PARSE_ONCE_CONTENT */`;
  return {
    route,
    hero,
    server,
    content,
    files: [
      { path: "src/routes/index.tsx", content: route },
      { path: "src/components/Hero.tsx", content: hero },
      { path: "src/server/get-page.ts", content: server },
      { path: "src/morph/content.ts", content },
    ],
  };
};

function expectOneParsePerSource(sourceFiles: ReturnType<typeof operationFiles>) {
  for (const source of [
    sourceFiles.route,
    sourceFiles.hero,
    sourceFiles.server,
    sourceFiles.content,
  ]) {
    const sourceCount = parserState.calls.filter(
      (parsed) => parsed === source,
    ).length;
    expect(sourceCount, source.split("\n").at(-1)).toBe(1);
  }
}

describe("B1 source parsing", () => {
  it("parses each original source file once during one route analysis", () => {
    parserState.calls.length = 0;
    const route = `import { createFileRoute } from "@tanstack/react-router";
import { getPage } from "../server/get-page";
import Hero from "../components/Hero";
function Home() { const { hero } = Route.useLoaderData(); return <Hero {...hero} />; }
export const Route = createFileRoute("/")({ loader: () => getPage(), component: Home });
/* B1_PARSE_ONCE_ROUTE */`;
    const hero = `export default function Hero({ title }: { title?: string }) { return <h1>{title}</h1>; }
/* B1_PARSE_ONCE_COMPONENT */`;
    const fields = `export const contentFields = { title: { type: "text" } } as const;
/* B1_PARSE_ONCE_FIELDS */`;
    const server = `import { createServerFn } from "@tanstack/react-start";
import { morph } from "../morph/content";
export const getPage = createServerFn().handler(() => morph.pages.get("/"));
/* B1_PARSE_ONCE_SERVER */`;
    const content = `export const morph = { pages: { get(path: string) { return path; } } };
/* B1_PARSE_ONCE_CONTENT */`;

    const analysis = analyzeB1Route(
      [
        { path: "src/routes/index.tsx", content: route },
        { path: "src/components/Hero.tsx", content: hero },
        { path: "src/components/Hero.fields.ts", content: fields },
        { path: "src/server/get-page.ts", content: server },
        { path: "src/morph/content.ts", content },
      ],
      "src/routes/index.tsx",
    );

    expect(analysis.instances).toHaveLength(1);
    expect(parserState.calls.filter((source) => source === route)).toHaveLength(1);
    expect(parserState.calls.filter((source) => source === hero)).toHaveLength(1);
    expect(parserState.calls.filter((source) => source === fields)).toHaveLength(1);
    expect(parserState.calls.filter((source) => source === server)).toHaveLength(1);
    expect(parserState.calls.filter((source) => source === content)).toHaveLength(1);
    expect(
      parserState.calls.some((source) => source.includes("__morphB1LoaderProbe")),
    ).toBe(false);
  });

  it("shares the same parse across preview injection and its B1 readers", () => {
    const sourceFiles = operationFiles();
    parserState.calls.length = 0;

    const result = injectPreviewBindings(sourceFiles.files);

    expect(result.files.find((file) => file.path === "src/routes/index.tsx"))
      .toBeDefined();
    expectOneParsePerSource(sourceFiles);
    expect(
      parserState.calls.some((source) => source.includes("__morphB1LoaderProbe")),
    ).toBe(false);
  });

  it("shares the same parse across section derivation and its B1 readers", () => {
    const sourceFiles = operationFiles();
    parserState.calls.length = 0;

    const result = deriveThemeRouteSections(
      sourceFiles.files,
      "src/routes/index.tsx",
    );

    expect(result.sections).toHaveLength(1);
    expectOneParsePerSource(sourceFiles);
  });
});
