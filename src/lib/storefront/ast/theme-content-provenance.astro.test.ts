// @vitest-environment node
/**
 * The Astro profile of the B1 analysis (M2 PR-B, D90): real `.astro`
 * sources, parsed by the real parser Worker in local workerd and accepted by
 * Core's `parseAstroTemplate`, projected by `projectAstroTemplate`, analysed
 * by `analyzeB1AstroRoute` with the route path from `astroRouteRegistry`.
 *
 * Every expectation is handwritten (astro-b1-samples.ts). Where a sample has
 * a Start twin, the Astro result must equal Start's, except where the Astro
 * profile is deliberately stricter; those are listed and asserted on both
 * sides. Start's own behaviour is pinned by its unchanged B1 test files.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  startLocalAstroParser,
  type LocalAstroParser,
} from "@morph/astro-parser-worker/testing";
import { astroRouteRegistry } from "@/lib/storefront/compiler/astro-route-registry";
import { parseAstroTemplate } from "@/lib/storefront/source-language/astro-parser-client";
import {
  projectAstroTemplate,
  projectAstroTemplateReverseCheck,
  type AstroProjection,
  type AstroProjectionResult,
} from "@/lib/storefront/source-language/astro-source-language";
import {
  ASTRO_B1_SAMPLES,
  ASTRO_FIXTURE,
  ASTRO_STRICTER_THAN_START,
  HERO_BOTH,
  START_FIXTURE,
  astroPage,
  type AstroB1Summary,
} from "@/lib/test-utils/astro-b1-samples";

import {
  analyzeB1AstroRoute,
  analyzeB1Route,
  type B1RouteAnalysis,
  type B1SourceFile,
} from "./theme-content-provenance";

let parser: LocalAstroParser;
beforeAll(async () => {
  parser = await startLocalAstroParser();
}, 60_000);
afterAll(() => parser?.dispose());

type Variant = "in-place" | "hoist";

async function project(source: string, variant: Variant = "in-place") {
  const outcome = await parseAstroTemplate(parser.binding, source);
  if (outcome.status !== "confirmed") {
    throw new Error(`parser refused: ${outcome.code} ${outcome.detail}`);
  }
  const result: AstroProjectionResult =
    variant === "in-place"
      ? projectAstroTemplate(source, outcome.result)
      : projectAstroTemplateReverseCheck(source, outcome.result, variant);
  if (!result.ok)
    throw new Error(`projection refused: ${result.reason} ${result.detail}`);
  return result;
}

/** Projections of every `.astro` module in a file set. */
async function projectAll(files: readonly B1SourceFile[]) {
  const projections = new Map<string, AstroProjection>();
  for (const file of files) {
    if (file.path.endsWith(".astro")) {
      projections.set(file.path, await project(file.content));
    }
  }
  return projections;
}

let fixtureProjections: Map<string, AstroProjection>;
beforeAll(async () => {
  fixtureProjections = await projectAll(ASTRO_FIXTURE);
}, 60_000);

function routeOf(files: readonly B1SourceFile[], routeFile: string) {
  const route = astroRouteRegistry(files).routes.find(
    (record) => record.sourcePath === routeFile,
  );
  if (!route) throw new Error(`${routeFile} is not a route`);
  return route;
}

async function analyzeAstro(
  routeFile: string,
  source: string,
  options: {
    variant?: Variant;
    extraFiles?: readonly B1SourceFile[];
    skipProjection?: readonly string[];
  } = {},
): Promise<B1RouteAnalysis> {
  const extra = options.extraFiles ?? [];
  const files: B1SourceFile[] = [
    ...ASTRO_FIXTURE,
    ...extra,
    { path: routeFile, content: source },
  ];
  const projections = new Map(fixtureProjections);
  for (const [path, projection] of await projectAll(extra)) {
    projections.set(path, projection);
  }
  projections.set(routeFile, await project(source, options.variant));
  for (const path of options.skipProjection ?? []) projections.delete(path);
  return analyzeB1AstroRoute({
    files,
    route: routeOf(files, routeFile),
    projections,
  });
}

function summarize(analysis: B1RouteAnalysis): AstroB1Summary[] {
  return analysis.instances.map((instance) => ({
    name: instance.componentName,
    section: instance.section,
    claims: Object.values(instance.claims)
      .flatMap((claim) =>
        claim.kind === "claim" ? [`${claim.slot}.${claim.field}`] : [],
      )
      .sort(),
  }));
}

function analyzeStart(source: string, routeFile: string) {
  return analyzeB1Route(
    [...START_FIXTURE, { path: routeFile, content: source }],
    routeFile,
  );
}

const startRouteOf = (routeFile: string) =>
  routeFile.replace("src/pages/", "src/routes/").replace(/\.astro$/, ".tsx");

describe("the experiment's samples under the Astro profile", () => {
  for (const sample of ASTRO_B1_SAMPLES) {
    it(`${sample.id}: ${sample.title}`, async () => {
      if (sample.expected === "refused") {
        const outcome = await parseAstroTemplate(parser.binding, sample.source);
        expect(outcome).toMatchObject({
          status: "refused",
          class: "author-syntax",
          reason: "author-syntax",
        });
        return;
      }
      const analysis = await analyzeAstro(sample.routeFile, sample.source);
      expect(summarize(analysis)).toEqual(sample.expected);
      expect(analysis.diagnostics).toEqual([]);
    });
  }
});

describe("Astro equals Start on every TSX twin, except where Astro is stricter", () => {
  for (const sample of ASTRO_B1_SAMPLES.filter((entry) => entry.twin)) {
    it(sample.id, async () => {
      const astro = summarize(
        await analyzeAstro(sample.routeFile, sample.source),
      );
      const start = summarize(
        analyzeStart(sample.twin!, startRouteOf(sample.routeFile)),
      );
      const stricter = ASTRO_STRICTER_THAN_START[sample.id];
      if (stricter) {
        // Start claims here (its rule, unchanged); Astro does not (D90-3).
        expect(start).toEqual(stricter);
        expect(astro).not.toEqual(start);
        expect(astro.map(({ name, section }) => ({ name, section }))).toEqual(
          start.map(({ name, section }) => ({ name, section })),
        );
        expect(astro.every((instance) => instance.claims.length === 0)).toBe(
          true,
        );
      } else {
        expect(astro).toEqual(start);
      }
    });
  }

  it("the stricter samples are exactly N3, N4 and N5", () => {
    expect(Object.keys(ASTRO_STRICTER_THAN_START).sort()).toEqual([
      "N3",
      "N4",
      "N5",
    ]);
  });

  it("the stricter rule names its reason on the claim", async () => {
    const sample = ASTRO_B1_SAMPLES.find((entry) => entry.id === "N3")!;
    const analysis = await analyzeAstro(sample.routeFile, sample.source);
    expect(analysis.instances[0]!.claims.title).toEqual({
      kind: "none",
      state: "unknown",
      reason: "rendered inside a conditional or a loop: not one instance",
    });
  });
});

describe("D90-1 reverse check: hoisting nested JSX outward binds wrongly", () => {
  const sampleById = (id: string) =>
    ASTRO_B1_SAMPLES.find((entry) => entry.id === id)!;

  it("N1: a conditional instance hoisted to the top claims fields it must not", async () => {
    const sample = sampleById("N1");
    expect(
      summarize(
        await analyzeAstro(sample.routeFile, sample.source, {
          variant: "hoist",
        }),
      ),
    ).toEqual([HERO_BOTH]);
  });

  it("S1: a map parameter named hero, hoisted out of its scope, takes the page's hero", async () => {
    const sample = sampleById("S1");
    expect(
      summarize(
        await analyzeAstro(sample.routeFile, sample.source, {
          variant: "hoist",
        }),
      ),
    ).toEqual([
      { name: "Hero", section: null, claims: [] },
      { name: "Card", section: null, claims: [] },
    ]);
  });

  it("S3: a parameter named morph, hoisted out of its scope, becomes the trusted morph", async () => {
    const sample = sampleById("S3");
    expect(
      summarize(
        await analyzeAstro(sample.routeFile, sample.source, {
          variant: "hoist",
        }),
      ),
    ).toEqual([
      HERO_BOTH,
      { name: "Card", section: "card", claims: ["card.title"] },
    ]);
  });

  it("in-place grafting gives the expected result where hoisting differs", async () => {
    const changed: string[] = [];
    for (const sample of ASTRO_B1_SAMPLES) {
      if (sample.expected === "refused") continue;
      const hoisted = summarize(
        await analyzeAstro(sample.routeFile, sample.source, {
          variant: "hoist",
        }),
      );
      if (JSON.stringify(hoisted) !== JSON.stringify(sample.expected))
        changed.push(sample.id);
    }
    expect(changed).toEqual(
      expect.arrayContaining(["N1", "N3", "N4", "N5", "S1", "S2", "S3"]),
    );
  });
});

describe("the trusted morph is the platform alias only", () => {
  const TEMPLATE = "<Hero {...hero} />";
  const body =
    'const home = await morph.pages.get("/");\nconst { hero } = home;\n';
  const page = (morphImport: string) =>
    `---\nimport Hero from "../components/Hero.astro";\n${morphImport}\n${body}---\n${TEMPLATE}\n`;
  const UNTRUSTED = [{ name: "Hero", section: null, claims: [] }];

  it("@morph/sdk/astro is trusted", async () => {
    const analysis = await analyzeAstro(
      "src/pages/index.astro",
      page('import { morph } from "@morph/sdk/astro";'),
    );
    expect(summarize(analysis)).toEqual([HERO_BOTH]);
  });

  it("an author's own src/morph/content.ts is not, on Astro (it is Start's trusted module)", async () => {
    const extraFiles = [
      {
        path: "src/morph/content.ts",
        content: 'export { morph } from "@morph/sdk/astro";\n',
      },
    ];
    const analysis = await analyzeAstro(
      "src/pages/index.astro",
      page('import { morph } from "../morph/content";'),
      { extraFiles },
    );
    expect(summarize(analysis)).toEqual(UNTRUSTED);
  });

  it("a local module named like the SDK is not", async () => {
    const extraFiles = [
      {
        path: "src/@morph/sdk/astro.ts",
        content: "export const morph = { pages: { get: async () => ({}) } };\n",
      },
    ];
    const analysis = await analyzeAstro(
      "src/pages/index.astro",
      page('import { morph } from "../@morph/sdk/astro";'),
      { extraFiles },
    );
    expect(summarize(analysis)).toEqual(UNTRUSTED);
  });

  it("a relative path to the platform's own copy (.morph/sdk/astro) is not", async () => {
    const extraFiles = [
      {
        path: ".morph/sdk/astro/index.ts",
        content: "export const morph = {};\n",
      },
    ];
    const analysis = await analyzeAstro(
      "src/pages/index.astro",
      page('import { morph } from "../../.morph/sdk/astro/index.ts";'),
      { extraFiles },
    );
    expect(summarize(analysis)).toEqual(UNTRUSTED);
  });

  it("a type-only or namespace import of the alias is not a morph binding", async () => {
    for (const morphImport of [
      'import type { morph } from "@morph/sdk/astro";',
      'import * as morph from "@morph/sdk/astro";',
    ]) {
      const analysis = await analyzeAstro(
        "src/pages/index.astro",
        page(morphImport),
      );
      expect(summarize(analysis), morphImport).toEqual(UNTRUSTED);
    }
  });

  it("Start still trusts only src/morph/content.ts, not the Astro alias", () => {
    const route = "src/routes/index.tsx";
    const twin = (morphImport: string) =>
      'import { createFileRoute } from "@tanstack/react-router";\n' +
      `${morphImport}\n` +
      'import Hero from "../components/Hero";\n' +
      'export const Route = createFileRoute("/")({ component: Page });\n' +
      `async function Page() {\n${body}return <Hero {...hero} />;\n}\n`;
    expect(
      summarize(
        analyzeStart(twin('import { morph } from "../morph/content";'), route),
      ),
    ).toEqual([HERO_BOTH]);
    expect(
      summarize(
        analyzeStart(twin('import { morph } from "@morph/sdk/astro";'), route),
      ),
    ).toEqual(UNTRUSTED);
  });
});

describe("<Fragment> by resolved identity (D90-5)", () => {
  const HOME =
    'const home = await morph.pages.get("/");\nconst { hero } = home;\n';

  it("the built-in Fragment is no instance; what it wraps is", async () => {
    const analysis = await analyzeAstro(
      "src/pages/index.astro",
      astroPage(HOME, "<Fragment><Hero {...hero} /></Fragment>"),
    );
    expect(summarize(analysis)).toEqual([HERO_BOTH]);
  });

  it("an author's imported component named Fragment is an instance of that component", async () => {
    const source =
      '---\nimport Fragment from "../components/Fragment.astro";\n' +
      'import { morph } from "@morph/sdk/astro";\n' +
      `${HOME}---\n<Fragment {...hero} />\n`;
    const analysis = await analyzeAstro("src/pages/index.astro", source);
    expect(summarize(analysis)).toEqual([
      { name: "Fragment", section: "hero", claims: ["hero.title"] },
    ]);
    expect(analysis.instances[0]).toMatchObject({
      componentPath: "src/components/Fragment.astro",
      componentExport: "default",
    });
  });

  it("a frontmatter local named Fragment is that local, not the built-in", async () => {
    const analysis = await analyzeAstro(
      "src/pages/index.astro",
      astroPage(`${HOME}const Fragment = Hero;\n`, "<Fragment {...hero} />"),
    );
    expect(
      analysis.instances.map((instance) => instance.componentName),
    ).toEqual(["Fragment"]);
    expect(analysis.instances[0]!.componentPath).toBeNull();
  });
});

describe("the route path comes from the registry", () => {
  const ABOUT =
    '---\nimport Hero from "../components/Hero.astro";\nimport { morph } from "@morph/sdk/astro";\n' +
    'const about = await morph.pages.get("/about");\n---\n<Hero {...about.intro} />\n';

  it("src/pages/about.astro is /about, and claims /about's Document only", async () => {
    const analysis = await analyzeAstro("src/pages/about.astro", ABOUT);
    expect(summarize(analysis)).toEqual([
      { name: "Hero", section: "intro", claims: ["intro.desc", "intro.title"] },
    ]);
    const other = await analyzeAstro("src/pages/contact.astro", ABOUT);
    expect(summarize(other)).toEqual([
      { name: "Hero", section: "intro", claims: [] },
    ]);
  });

  it("a createFileRoute written in the frontmatter does not name the route", async () => {
    const source = ABOUT.replace(
      "const about",
      'import { createFileRoute } from "@tanstack/react-router";\nexport const Route = createFileRoute("/contact")({});\nconst about',
    );
    expect(
      summarize(await analyzeAstro("src/pages/about.astro", source)),
    ).toEqual([
      { name: "Hero", section: "intro", claims: ["intro.desc", "intro.title"] },
    ]);
  });

  it("a dynamic route claims no page field, and says why", async () => {
    const analysis = await analyzeAstro("src/pages/[slug].astro", ABOUT);
    expect(summarize(analysis)).toEqual([
      { name: "Hero", section: "intro", claims: [] },
    ]);
    expect(analysis.diagnostics).toEqual([
      "src/pages/[slug].astro has no static route path; page fields are not claimed",
    ]);
  });

  it("a page without a projection of its own content is not analysed", async () => {
    const files = [
      ...ASTRO_FIXTURE,
      { path: "src/pages/about.astro", content: ABOUT },
    ];
    const stale = await project(ABOUT.replace("intro", "team"));
    for (const projections of [
      new Map(fixtureProjections),
      new Map([
        ...fixtureProjections,
        ["src/pages/about.astro", stale] as const,
      ]),
    ]) {
      const analysis = analyzeB1AstroRoute({
        files,
        route: routeOf(files, "src/pages/about.astro"),
        projections,
      });
      expect(analysis.instances).toEqual([]);
      expect(analysis.diagnostics).toEqual([
        "src/pages/about.astro has no parser projection of its content",
      ]);
    }
  });
});

describe("reachability follows .astro imports", () => {
  const HOME =
    'const home = await morph.pages.get("/");\nconst { hero } = home;\n';
  const MUTATE =
    'import { morph } from "@morph/sdk/astro";\n' +
    'const page = await morph.pages.get("/");\npage.hero.title = "changed";\n';

  // A replaced field under the spread slot makes the whole spread unknown,
  // as in sample S5: which keys the copy has is no longer known.
  const TAINTED = [{ name: "Hero", section: "hero", claims: [] }];
  const READ_ONLY = MUTATE.replace('page.hero.title = "changed";\n', "");

  it("an imported script module that changes the page through the alias taints it", async () => {
    const page = astroPage(
      `import "../lib/mutate";\n${HOME}`,
      "<Hero {...hero} />",
    );
    const analysis = await analyzeAstro("src/pages/index.astro", page, {
      extraFiles: [
        { path: "src/lib/mutate.ts", content: `${MUTATE}export {};\n` },
      ],
    });
    expect(summarize(analysis)).toEqual(TAINTED);
    expect(analysis.taints).toContain("set|page:hero.title");
    // Control: the same module, reading only.
    const control = await analyzeAstro("src/pages/index.astro", page, {
      extraFiles: [
        { path: "src/lib/mutate.ts", content: `${READ_ONLY}export {};\n` },
      ],
    });
    expect(summarize(control)).toEqual([HERO_BOTH]);
  });

  it("an imported .astro component that does the same taints it too", async () => {
    const page = astroPage(
      `import Mutator from "../components/Mutator.astro";\n${HOME}`,
      "<Mutator />\n<Hero {...hero} />",
    );
    const analysis = await analyzeAstro("src/pages/index.astro", page, {
      extraFiles: [
        {
          path: "src/components/Mutator.astro",
          content: `---\n${MUTATE}---\n<i>m</i>\n`,
        },
      ],
    });
    expect(summarize(analysis)).toEqual([
      { name: "Mutator", section: null, claims: [] },
      ...TAINTED,
    ]);
    expect(analysis.taints).toContain("set|page:hero.title");
    const control = await analyzeAstro("src/pages/index.astro", page, {
      extraFiles: [
        {
          path: "src/components/Mutator.astro",
          content: `---\n${READ_ONLY}---\n<i>m</i>\n`,
        },
      ],
    });
    expect(summarize(control)).toEqual([
      { name: "Mutator", section: null, claims: [] },
      HERO_BOTH,
    ]);
  });

  it("a reachable .astro module without a projection taints every root (fail closed)", async () => {
    const analysis = await analyzeAstro(
      "src/pages/index.astro",
      astroPage(HOME, "<Hero {...hero} />"),
      { skipProjection: ["src/components/Card.astro"] },
    );
    expect(analysis.taints).toEqual(expect.arrayContaining(["page:*"]));
    expect(summarize(analysis)).toEqual([
      { name: "Hero", section: "hero", claims: [] },
    ]);
  });

  it("a reachable template-only .astro module is never read by Babel in place of its projection", async () => {
    // `<main><slot name="main" /><slot /></main>` happens to be valid TSX, so
    // a Babel fallback would read it as "no taint". Without its projection
    // it must be unreadable, like any other .astro module.
    const source =
      '---\nimport Hero from "../components/Hero.astro";\nimport Layout from "../components/Layout.astro";\n' +
      'import { morph } from "@morph/sdk/astro";\n' +
      `${HOME}---\n<Layout><Hero {...hero} /></Layout>\n`;
    const analysis = await analyzeAstro("src/pages/index.astro", source, {
      skipProjection: ["src/components/Layout.astro"],
    });
    expect(analysis.taints).toEqual(expect.arrayContaining(["page:*"]));
    expect(summarize(analysis)).toEqual([
      { name: "Layout", section: null, claims: [] },
      { name: "Hero", section: "hero", claims: [] },
    ]);
    const projected = await analyzeAstro("src/pages/index.astro", source);
    expect(summarize(projected)).toEqual([
      { name: "Layout", section: null, claims: [] },
      HERO_BOTH,
    ]);
  });

  it("an .astro module that is not reachable needs no projection", async () => {
    const analysis = await analyzeAstro(
      "src/pages/index.astro",
      '---\nimport Hero from "../components/Hero.astro";\nimport { morph } from "@morph/sdk/astro";\n' +
        `${HOME}---\n<Hero {...hero} />\n`,
      {
        skipProjection: [
          "src/components/Card.astro",
          "src/components/Layout.astro",
        ],
      },
    );
    expect(summarize(analysis)).toEqual([HERO_BOTH]);
  });
});
