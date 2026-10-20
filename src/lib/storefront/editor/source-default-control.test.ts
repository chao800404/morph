import { describe, expect, it } from "vitest";
import { analyzeSourceDefaultFields } from "./source-default-control";

const HERO = "src/components/Hero.tsx";
const heroSource = `export const contentFields = {
  title: { type: "text", label: "Title" },
  desc: { type: "text", label: "Desc" },
};
export default function Hero({ title = "Default title", desc = "Default desc" }) {
  return (
    <section>
      <h1>{title}</h1>
      <p>{desc}</p>
    </section>
  );
}`;
const route = (imports: string, body: string) => ({
  path: "src/routes/index.tsx",
  content: `import { createFileRoute } from "@tanstack/react-router";
${imports}
export const Route = createFileRoute("/")({ component: Home });
function Home() {
${body}
}`,
});
const analyze = (
  files: Array<{ path: string; content: string }>,
  componentSourcePath = HERO,
) =>
  analyzeSourceDefaultFields({
    files,
    componentSourcePath,
    fieldKeys: ["title", "desc"],
  });
const withHero = (...files: Array<{ path: string; content: string }>) => [
  { path: HERO, content: heroSource },
  ...files,
];

describe("analyzeSourceDefaultFields", () => {
  it("explicit props from loader data: both fields are controlled by the caller", () => {
    const result = analyze(
      withHero(
        route(
          `import Hero from "../components/Hero";`,
          `  const { hero } = Route.useLoaderData();
  const { title, desc } = hero;
  return <main><Hero title={title} desc={desc} /></main>;`,
        ),
      ),
    );
    expect(result).toEqual({
      title: { status: "code", reason: "passed-by-caller" },
      desc: { status: "code", reason: "passed-by-caller" },
    });
  });

  it("a prop the caller leaves out renders the default, per field", () => {
    const result = analyze(
      withHero(
        route(
          `import Hero from "../components/Hero";`,
          `  return <main><Hero title="Code title" /></main>;`,
        ),
      ),
    );
    expect(result).toEqual({
      title: { status: "code", reason: "passed-by-caller" },
      desc: { status: "default" },
    });
  });

  it("no props passed at all: every default renders", () => {
    const result = analyze(
      withHero(
        route(
          `import Hero from "../components/Hero";`,
          `  return <main><Hero /></main>;`,
        ),
      ),
    );
    expect(result).toEqual({
      title: { status: "default" },
      desc: { status: "default" },
    });
  });

  it("a spread could set any prop, so every field is controlled", () => {
    const result = analyze(
      withHero(
        route(
          `import Hero from "../components/Hero";`,
          `  const { hero } = Route.useLoaderData();
  return <main><Hero {...hero} title="x" /></main>;`,
        ),
      ),
    );
    expect(result).toEqual({
      title: { status: "code", reason: "spread-by-caller" },
      desc: { status: "code", reason: "spread-by-caller" },
    });
  });

  it("one call site passing the prop is enough: the instance on screen is not known", () => {
    const result = analyze(
      withHero(
        route(
          `import Hero from "../components/Hero";`,
          `  return <main><Hero /><Hero desc="Second" /></main>;`,
        ),
      ),
    );
    expect(result.title).toEqual({ status: "default" });
    expect(result.desc).toEqual({ status: "code", reason: "passed-by-caller" });
  });

  it("no element rendering the component: where it renders is unknown", () => {
    expect(analyze(withHero())).toEqual({
      title: { status: "code", reason: "call-site-unknown" },
      desc: { status: "code", reason: "call-site-unknown" },
    });
  });

  it.each([
    [
      "passed as a value",
      `import Hero from "../components/Hero";`,
      `  const Section = Hero;\n  return <main><Section title="x" /></main>;`,
    ],
    [
      "namespace import",
      `import * as H from "../components/Hero";`,
      `  return <main><H.default /></main>;`,
    ],
    [
      "dynamic import",
      `import { lazy } from "react";\nconst Hero = lazy(() => import("../components/Hero"));`,
      `  return <main><Hero /></main>;`,
    ],
    [
      "an alias this cannot resolve",
      `import Hero from "@/components/Hero";`,
      `  return <main><Hero title="x" /></main>;`,
    ],
    [
      "a shadowed name",
      `import Hero from "../components/Hero";`,
      `  const render = (Hero: any) => <Hero title="x" />;\n  return <main><Hero />{render(null)}</main>;`,
    ],
  ])("%s: every field is controlled by code", (_name, imports, body) => {
    const result = analyze(withHero(route(imports, body)));
    expect(result).toEqual({
      title: { status: "code", reason: "call-site-unknown" },
      desc: { status: "code", reason: "call-site-unknown" },
    });
  });

  it("a re-export elsewhere hides further call sites", () => {
    const result = analyze(
      withHero(
        route(
          `import Hero from "../components/Hero";`,
          `  return <main><Hero /></main>;`,
        ),
        {
          path: "src/components/index.ts",
          content: `export { default as Hero } from "./Hero";`,
        },
      ),
    );
    expect(result.title).toEqual({
      status: "code",
      reason: "call-site-unknown",
    });
  });

  it("a type-only use of the component renders nothing and is ignored", () => {
    const result = analyze(
      withHero(
        route(
          `import Hero from "../components/Hero";\nimport type { ComponentProps } from "react";\ntype P = ComponentProps<typeof Hero>;`,
          `  return <main><Hero /></main>;`,
        ),
      ),
    );
    expect(result.title).toEqual({ status: "default" });
  });

  it("named exports are followed by the name they are imported under", () => {
    const named = `export function Banner({ title = "Banner default" }) {
  return <h2>{title}</h2>;
}`;
    const files = [
      { path: "src/components/Banner.tsx", content: named },
      route(
        `import { Banner as B } from "../components/Banner";`,
        `  return <main><B title="Page" /></main>;`,
      ),
    ];
    expect(
      analyzeSourceDefaultFields({
        files,
        componentSourcePath: "src/components/Banner.tsx",
        fieldKeys: ["title"],
      }),
    ).toEqual({ title: { status: "code", reason: "passed-by-caller" } });
  });

  it("a field with no default to rewrite is controlled by code", () => {
    const files = withHero(
      route(`import Hero from "../components/Hero";`, `  return <Hero />;`),
    );
    expect(
      analyzeSourceDefaultFields({
        files,
        componentSourcePath: HERO,
        fieldKeys: ["missing"],
      }),
    ).toEqual({ missing: { status: "code", reason: "no-default" } });
  });

  it("a component wrapped in memo is not followed", () => {
    const wrapped = `import { memo } from "react";
const Hero = memo(function Hero({ title = "Default title" }) {
  return <h1>{title}</h1>;
});
export default Hero;`;
    const files = [
      { path: HERO, content: wrapped },
      route(`import Hero from "../components/Hero";`, `  return <Hero />;`),
    ];
    expect(
      analyzeSourceDefaultFields({
        files,
        componentSourcePath: HERO,
        fieldKeys: ["title"],
      }),
    ).toEqual({ title: { status: "code", reason: "call-site-unknown" } });
  });
});
