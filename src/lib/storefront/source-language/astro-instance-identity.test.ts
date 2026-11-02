// @vitest-environment node
/**
 * Core's instance identity verification (M2 PR-I, P5; design v2 §6, §12
 * items 10–12), as pure functions over real inputs: each route is parsed by
 * the real parser Worker in local workerd, projected and analysed by
 * `analyzeB1AstroRoute`, and its markers are the ones the product preview
 * plugin writes (compiler-rs 0.5.1 Wasm in Node). No database: the DAL tests
 * that a refused write leaves D1 unchanged are PR-E's (design v2 §8).
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  startLocalAstroParser,
  type LocalAstroParser,
} from "@morph/astro-parser-worker/testing";
import { astroRouteRegistry } from "@/lib/storefront/compiler/astro-route-registry";
import {
  analyzeB1AstroRoute,
  type B1SourceFile,
} from "@/lib/storefront/ast/theme-content-provenance";
import {
  ASTRO_B1_SAMPLES,
  ASTRO_FIXTURE,
  astroPage,
} from "@/lib/test-utils/astro-b1-samples";
import {
  parseAstroInNode,
  runAstroPreviewLocatePlugin,
} from "@/lib/test-utils/astro-compiler-node";
import {
  astroBoundaryCandidates,
  astroPreviewSourceHash,
  astroTopLevelBindingNames,
  parseAstroInstanceIdentity,
  type AstroBoundaryElement,
} from "@/lib/storefront/theme-framework/astro-preview-locate";

import { parseAstroTemplate } from "./astro-parser-client";
import {
  astroBindingViewIdentities,
  astroSameFileNestingRisk,
  astroSourceDigest,
  astroTemplateBoundaryElements,
  verifyAstroInstanceIdentity,
  verifyAstroSectionWriteIdentity,
  type AstroIdentitySnapshot,
  type AstroRouteIdentityInput,
} from "./astro-instance-identity";
import {
  projectAstroTemplate,
  type AstroProjection,
} from "./astro-source-language";

const NONCE = "0123456789abcdef";
const INDEX = "src/pages/index.astro";
const HERO = "src/components/Hero.astro";
const CARD = "src/components/Card.astro";

let parser: LocalAstroParser;
beforeAll(async () => {
  parser = await startLocalAstroParser();
}, 60_000);
afterAll(() => parser?.dispose());

async function project(source: string) {
  const outcome = await parseAstroTemplate(parser.binding, source);
  if (outcome.status !== "confirmed") {
    throw new Error(`parser refused: ${outcome.code} ${outcome.detail}`);
  }
  const projection = projectAstroTemplate(source, outcome.result);
  if (!projection.ok)
    throw new Error(`projection refused: ${projection.reason}`);
  return { template: outcome.result, projection };
}

type Fixture = Readonly<{
  snapshot: AstroIdentitySnapshot;
  route: AstroRouteIdentityInput;
  /** The plugin's boundary ids for the route, in source order. */
  markers: string[];
}>;

/** Core's reading of one snapshot, and the markers its preview would show. */
async function fixture(
  routeSource: string,
  options: {
    routeFile?: string;
    replace?: readonly B1SourceFile[];
    extra?: readonly B1SourceFile[];
  } = {},
): Promise<Fixture> {
  const routeFile = options.routeFile ?? INDEX;
  const replaced = new Map(
    (options.replace ?? []).map((file) => [file.path, file.content]),
  );
  const files: B1SourceFile[] = [
    ...ASTRO_FIXTURE.map((file) => ({
      path: file.path,
      content: replaced.get(file.path) ?? file.content,
    })),
    ...(options.extra ?? []),
    { path: routeFile, content: routeSource },
  ];
  const projections = new Map<string, AstroProjection>();
  let routeTemplate: AstroRouteIdentityInput["template"] | null = null;
  for (const file of files) {
    if (!file.path.endsWith(".astro")) continue;
    const { template, projection } = await project(file.content);
    projections.set(file.path, projection);
    if (file.path === routeFile) routeTemplate = template;
  }
  const route = astroRouteRegistry(files).routes.find(
    (record) => record.sourcePath === routeFile,
  )!;
  const analysis = analyzeB1AstroRoute({ files, route, projections });
  const annotated = await runAstroPreviewLocatePlugin(
    routeSource,
    routeFile,
    NONCE,
  );
  const markers = [
    ...(annotated ?? "").matchAll(/<!--morph:s2 ([^-"]+)-->/g),
  ].map((match) => match[1]!);
  return {
    snapshot: { files },
    route: {
      routeFile,
      template: routeTemplate!,
      projection: projections.get(routeFile)!,
      analysis,
    },
    markers,
  };
}

const content = (fx: Fixture, path: string) =>
  fx.snapshot.files.find((file) => file.path === path)!.content;

/** What the preview reports for an element of `file`. */
async function clickIn(
  fx: Fixture,
  file: string,
  digestOf = content(fx, file),
) {
  return {
    sourceLocation: `${file}:4:1`,
    sourceDigest: await astroSourceDigest(digestOf),
  };
}

const withRange = (id: string, start: number, end: number) => {
  const parts = id.split(":");
  return [...parts.slice(0, 3), String(start), String(end)].join(":");
};

const HOME =
  'const home = await morph.pages.get("/");\nconst { hero, card } = home;\n';
const A6 = astroPage(HOME, "<Hero {...hero} />\n<Card {...card} />");
const I2 = ASTRO_B1_SAMPLES.find((sample) => sample.id === "I2")!.source;
const ABOUT = ASTRO_B1_SAMPLES.find((sample) => sample.id === "A3")!;

describe("Core and the plugin apply one boundary rule (U1, Wasm on both sides)", () => {
  // Same compiler build on both sides here (the plugin's raw AST in Node,
  // Core's contract v2 answer from workerd); the container's native build
  // is compared in the container, not here.
  const fragmentSamples = [
    "<Fragment><Hero {...hero} /></Fragment>",
    '<Card><Fragment slot="title"><b>t</b></Fragment><p>body</p></Card>',
    "<UI.Fragment />\n<Hero {...hero} />",
  ].map((template) => astroPage(HOME, template));
  const authorFragment = [
    '---\nimport Fragment from "../components/Fragment.astro";\nimport Hero from "../components/Hero.astro";\n---\n<Hero title="a" />\n<Fragment title="b" />\n',
    '---\nimport { Badge as Fragment } from "../components/ui";\n---\n<Fragment label="b" />\n',
    '---\nimport Hero from "../components/Hero.astro";\nconst Fragment = Hero;\n---\n<Fragment title="x" />\n<Hero title="y" />\n',
  ];
  const sources = [
    ...ASTRO_B1_SAMPLES.filter((sample) => sample.expected !== "refused").map(
      (sample) => sample.source,
    ),
    ...fragmentSamples,
    ...authorFragment,
  ];

  it("gives the same candidate ranges for every sample", async () => {
    for (const source of sources) {
      const { template, projection } = await project(source);
      const statements = (
        projection.ast as unknown as { program: { body: object[] } }
      ).program.body.filter((node) => !projection.synthetic.has(node));
      const core = astroBoundaryCandidates(
        astroTemplateBoundaryElements(template),
        astroTopLevelBindingNames(statements),
      );
      const annotated = (await runAstroPreviewLocatePlugin(
        source,
        INDEX,
        NONCE,
      ))!;
      const plugin = [...annotated.matchAll(/<!--morph:s2 ([^-"]+)-->/g)].map(
        (match) => {
          const { start, end } = parseAstroInstanceIdentity(match[1]!)!;
          return { start, end };
        },
      );
      expect(plugin, source).toEqual(core);
      // The plugin's `src` (Node's sha256) is Core's digest of the same text.
      const digest = await astroSourceDigest(source);
      for (const match of annotated.matchAll(/<!--morph:s2 ([^-"]+)-->/g)) {
        expect(parseAstroInstanceIdentity(match[1]!)!.src).toBe(digest);
      }
      // And both read the same frontmatter bindings.
      const { ast } = parseAstroInNode(source);
      expect(
        astroTopLevelBindingNames(
          (ast.frontmatter as { program: { body: unknown[] } }).program.body,
        ),
      ).toEqual(astroTopLevelBindingNames(statements));
    }
  });

  it("reads a slot attribute and tag names off the answer as the plugin reads them", async () => {
    const { template } = await project(
      astroPage("", '<Layout><Hero slot="main" /><UI.Badge /></Layout>'),
    );
    const elements: AstroBoundaryElement[] =
      astroTemplateBoundaryElements(template);
    expect(elements.map(({ tag, slotted }) => [tag, slotted])).toEqual([
      ["Layout", false],
      ["Hero", true],
      ["UI.Badge", false],
    ]);
  });
});

describe("a selection's instance identity (design v2 §6 steps 1–7)", () => {
  it("confirms each instance by its range, with its component file's digest", async () => {
    const fx = await fixture(A6);
    expect(fx.markers).toHaveLength(2);
    const [hero, card] = await Promise.all(
      fx.markers.map((marker) =>
        verifyAstroInstanceIdentity({ marker, ...fx }),
      ),
    );
    expect(hero).toMatchObject({
      ok: true,
      instance: { componentName: "Hero", section: "hero", componentPath: HERO },
      componentDigest: await astroSourceDigest(content(fx, HERO)),
      designSelection: null,
      designSelectionUnavailable: "no-selection",
    });
    expect(card).toMatchObject({
      ok: true,
      instance: { componentName: "Card", section: "card", componentPath: CARD },
    });
  });

  it("offers a Design selection for a click inside that component at the snapshot's version", async () => {
    const fx = await fixture(A6);
    const result = await verifyAstroInstanceIdentity({
      marker: fx.markers[0],
      selection: await clickIn(fx, HERO),
      ...fx,
    });
    expect(result).toMatchObject({
      ok: true,
      designSelection: {
        componentPath: HERO,
        sourceDigest: await astroSourceDigest(content(fx, HERO)),
      },
      designSelectionUnavailable: null,
    });
  });

  it("I2 regression: the second Hero after a <UI.Badge/> is card, the badge is no instance", async () => {
    const fx = await fixture(I2);
    expect(fx.markers).toHaveLength(3);
    const results = await Promise.all(
      fx.markers.map((marker) =>
        verifyAstroInstanceIdentity({ marker, ...fx }),
      ),
    );
    expect(results[0]).toMatchObject({
      ok: false,
      class: "capability-limit",
      reason: "no-instance",
    });
    expect(results[1]).toMatchObject({
      ok: true,
      instance: { section: "hero" },
    });
    expect(results[2]).toMatchObject({
      ok: true,
      instance: { section: "card" },
    });
  });

  it("tells two instances of one component apart (/about)", async () => {
    const fx = await fixture(ABOUT.source, { routeFile: ABOUT.routeFile });
    const sections = await Promise.all(
      fx.markers.map(async (marker) => {
        const result = await verifyAstroInstanceIdentity({ marker, ...fx });
        return result.ok ? result.instance.section : result.reason;
      }),
    );
    expect(sections).toEqual(["intro", "team"]);
  });

  it("refuses an old-format, missing or malformed id as legacy", async () => {
    const fx = await fixture(A6);
    for (const marker of [
      `${NONCE}:${astroPreviewSourceHash(A6)}:0`,
      null,
      undefined,
      "",
      fx.markers[0]!.toUpperCase(),
    ]) {
      expect(
        await verifyAstroInstanceIdentity({ marker, ...fx }),
      ).toMatchObject({
        ok: false,
        class: "temporarily-unconfirmable",
        reason: "preview-identity-legacy",
      });
    }
  });

  it("refuses another rule version", async () => {
    const fx = await fixture(A6);
    for (const rule of ["1", "3"]) {
      const parts = fx.markers[0]!.split(":");
      parts[1] = rule;
      expect(
        await verifyAstroInstanceIdentity({ marker: parts.join(":"), ...fx }),
      ).toMatchObject({ ok: false, reason: "preview-rule-mismatch" });
    }
  });

  it("refuses a preview of another route version as stale", async () => {
    const shown = await fixture(A6);
    const changed = await fixture(A6.replace("<Card", " <Card"));
    expect(
      await verifyAstroInstanceIdentity({
        marker: shown.markers[0],
        ...changed,
      }),
    ).toMatchObject({
      ok: false,
      class: "temporarily-unconfirmable",
      reason: "source-stale",
    });
  });

  it("refuses a click in a component file of another version, the route unchanged", async () => {
    const fx = await fixture(A6);
    const shownHero = content(fx, HERO);
    const changed = await fixture(A6, {
      replace: [
        {
          path: HERO,
          content: shownHero.replace("<p>{desc}</p>", "<p>{desc}!</p>"),
        },
      ],
    });
    expect(changed.markers).toEqual(fx.markers);
    expect(
      await verifyAstroInstanceIdentity({
        marker: changed.markers[0],
        selection: await clickIn(changed, HERO, shownHero),
        ...changed,
      }),
    ).toMatchObject({ ok: false, reason: "source-stale" });
  });

  it("refuses a range that is no candidate, even with the route's own digest", async () => {
    const fx = await fixture(A6);
    const { start, end } = parseAstroInstanceIdentity(fx.markers[0])!;
    for (const [s, e] of [
      [start, end + 1],
      [start, end - 1],
      [start + 1, end],
    ] as const) {
      expect(
        await verifyAstroInstanceIdentity({
          marker: withRange(fx.markers[0]!, s, e),
          ...fx,
        }),
      ).toMatchObject({ ok: false, reason: "preview-identity-mismatch" });
    }
  });

  it("confirms an author's imported Fragment like any component", async () => {
    const source = astroPage(
      HOME + 'import Fragment from "../components/Fragment.astro";\n',
      "<Fragment {...hero} />\n<Card {...card} />",
    );
    const fx = await fixture(source);
    expect(fx.markers).toHaveLength(2);
    const first = await verifyAstroInstanceIdentity({
      marker: fx.markers[0],
      ...fx,
    });
    expect(first).toMatchObject({
      ok: true,
      instance: { componentPath: "src/components/Fragment.astro" },
    });
  });

  it("refuses `const Fragment = Hero` as no instance, and leaves the page's other instances alone", async () => {
    const source = astroPage(
      HOME + "const Fragment = Hero;\n",
      "<Fragment {...hero} />\n<Card {...card} />",
    );
    const fx = await fixture(source);
    expect(fx.markers).toHaveLength(2);
    expect(
      await verifyAstroInstanceIdentity({ marker: fx.markers[0], ...fx }),
    ).toMatchObject({ ok: false, reason: "no-instance" });
    expect(
      await verifyAstroInstanceIdentity({ marker: fx.markers[1], ...fx }),
    ).toMatchObject({ ok: true, instance: { section: "card" } });
  });

  it("gives no Design selection for a click elsewhere or without a digest; Code stays", async () => {
    const fx = await fixture(A6);
    const hero = fx.markers[0]!;
    // Cross-component: the Card's file, and the page itself (slot content).
    for (const file of [CARD, INDEX]) {
      expect(
        await verifyAstroInstanceIdentity({
          marker: hero,
          selection: await clickIn(fx, file),
          ...fx,
        }),
      ).toMatchObject({
        ok: true,
        designSelection: null,
        designSelectionUnavailable: "cross-component",
      });
    }
    expect(
      await verifyAstroInstanceIdentity({
        marker: hero,
        selection: { sourceLocation: `${HERO}:4:1`, sourceDigest: null },
        ...fx,
      }),
    ).toMatchObject({
      ok: true,
      designSelection: null,
      designSelectionUnavailable: "no-source-digest",
    });
  });

  it("refuses an analysis that is not of the snapshot", async () => {
    const fx = await fixture(A6);
    const other = await fixture(A6.replace("<Card", " <Card"));
    expect(
      await verifyAstroInstanceIdentity({
        marker: fx.markers[0],
        snapshot: fx.snapshot,
        route: other.route,
      }),
    ).toMatchObject({ ok: false, reason: "analysis-inconsistent" });
  });
});

describe("the capability never stands in for verification (§7)", () => {
  it("a well-formed v2 identity with a wrong digest is refused, whatever was announced", async () => {
    // The verifier takes no capability at all: an editor that announced
    // astro-identity-v2 and one that did not reach the same checks.
    const fx = await fixture(A6);
    expect(
      await verifyAstroInstanceIdentity({
        marker: fx.markers[0],
        selection: {
          sourceLocation: `${HERO}:4:1`,
          sourceDigest: "0".repeat(64),
        },
        ...fx,
      }),
    ).toMatchObject({ ok: false, reason: "source-stale" });
  });
});

describe("a section write's identity (design v2 §6 step 8)", () => {
  async function write(
    fx: Fixture,
    identity: string | undefined,
    sectionId: string,
    componentPath = HERO,
  ) {
    return verifyAstroSectionWriteIdentity({
      input:
        identity === undefined
          ? undefined
          : {
              identity,
              componentDigest: await astroSourceDigest(
                content(fx, componentPath),
              ),
            },
      sectionId,
      ...fx,
    });
  }

  it("confirms the instance the write names", async () => {
    const fx = await fixture(I2);
    expect(await write(fx, fx.markers[2], "card")).toMatchObject({
      ok: true,
      instance: { section: "card" },
    });
  });

  it("refuses swapped instances: B's identity with A's section", async () => {
    const fx = await fixture(I2);
    expect(await write(fx, fx.markers[2], "hero")).toMatchObject({
      ok: false,
      reason: "preview-identity-mismatch",
    });
    expect(await write(fx, fx.markers[1], "card")).toMatchObject({
      ok: false,
      reason: "preview-identity-mismatch",
    });
  });

  it("refuses a write with no identity (an older editor) or an old-format one", async () => {
    const fx = await fixture(I2);
    expect(await write(fx, undefined, "card")).toMatchObject({
      ok: false,
      reason: "preview-identity-legacy",
    });
    expect(
      await write(fx, `${NONCE}:${astroPreviewSourceHash(I2)}:2`, "card"),
    ).toMatchObject({ ok: false, reason: "preview-identity-legacy" });
  });

  it("refuses a component digest the snapshot no longer has", async () => {
    const fx = await fixture(I2);
    expect(
      await verifyAstroSectionWriteIdentity({
        input: { identity: fx.markers[2]!, componentDigest: "0".repeat(64) },
        sectionId: "card",
        ...fx,
      }),
    ).toMatchObject({ ok: false, reason: "source-stale" });
  });
});

describe("the binding view's identities (P5, for PR-D)", () => {
  it("lists exactly the confirmable instances, keyed by range", async () => {
    const fx = await fixture(I2);
    const identities = await astroBindingViewIdentities(fx.snapshot, fx.route);
    const src = await astroSourceDigest(I2);
    const heroDigest = await astroSourceDigest(content(fx, HERO));
    expect(identities).toEqual(
      fx.markers.slice(1).map((marker) => {
        const { start, end } = parseAstroInstanceIdentity(marker)!;
        return {
          identity: { rule: 2, src, start, end },
          componentDigest: heroDigest,
        };
      }),
    );
  });
});

describe("reverse checks: what the identity rules prevent (§12 item 12)", () => {
  it("an ordinal mapping would bind I2's first Hero to card, and accept the swap", async () => {
    const fx = await fixture(I2);
    // Ordinal: the n-th marker is the n-th instance. The badge's marker is
    // 0 but the analysis has no instance for it, so marker 1 (the first
    // Hero) lands on instance 1, which is card: a write of the first Hero's
    // marker to "card" would pass. The identity check confirms hero instead,
    // and refuses that write.
    expect(fx.route.analysis.instances[1]?.section).toBe("card");
    expect(
      await verifyAstroInstanceIdentity({ marker: fx.markers[1], ...fx }),
    ).toMatchObject({ ok: true, instance: { section: "hero" } });
    const heroDigest = await astroSourceDigest(content(fx, HERO));
    expect(
      await verifyAstroSectionWriteIdentity({
        input: { identity: fx.markers[1]!, componentDigest: heroDigest },
        sectionId: "card",
        ...fx,
      }),
    ).toMatchObject({ ok: false, reason: "preview-identity-mismatch" });
  });

  it("an FNV check would accept a component file changed under a colliding hash", async () => {
    const fx = await fixture(A6);
    const shown = content(fx, HERO);
    // Two comment texts after which FNV-1a's state is equal: the files
    // differ, their FNV values do not.
    const [a, b] = fnvCollidingSuffixes(`${shown}<!-- `);
    const shownFile = `${shown}<!-- ${a} -->\n`;
    const servedFile = `${shown}<!-- ${b} -->\n`;
    expect(shownFile).not.toBe(servedFile);
    expect(astroPreviewSourceHash(shownFile)).toBe(
      astroPreviewSourceHash(servedFile),
    );
    const changed = await fixture(A6, {
      replace: [{ path: HERO, content: servedFile }],
    });
    expect(
      await verifyAstroInstanceIdentity({
        marker: changed.markers[0],
        selection: await clickIn(changed, HERO, shownFile),
        ...changed,
      }),
    ).toMatchObject({ ok: false, reason: "source-stale" });
  });
});

describe("same file is not same instance (review follow-up 1)", () => {
  const SLOT_NESTED = astroPage(
    HOME,
    '<Card {...card}><Card slot="inner" title="x" /></Card>',
  );

  /** A click in the Card's file at the snapshot's version. */
  const verifyCardClick = async (fx: Fixture, marker = fx.markers[0]) =>
    verifyAstroInstanceIdentity({
      marker,
      selection: await clickIn(fx, CARD),
      ...fx,
    });

  /** The guard's input for a fixture, as locateInstance builds it. */
  const nestingInput = (fx: Fixture) => {
    const elements = astroTemplateBoundaryElements(fx.route.template);
    const statements = (
      fx.route.projection.ast as unknown as { program: { body: object[] } }
    ).program.body.filter((node) => !fx.route.projection.synthetic.has(node));
    const boundNames = astroTopLevelBindingNames(statements);
    return {
      elements,
      candidates: astroBoundaryCandidates(elements, boundNames),
      boundNames,
      statements: statements as never,
      routeFile: INDEX,
      contentByPath: new Map(
        fx.snapshot.files.map((file) => [file.path, file.content]),
      ),
    };
  };

  it("refuses a Design selection when an unmarked slot= child renders the same component", async () => {
    const fx = await fixture(SLOT_NESTED);
    // The inner Card has slot=, so it has no marker: a click in it finds the
    // outer marker, with Card.astro and Card.astro's digest.
    expect(fx.markers).toHaveLength(1);
    expect(await verifyCardClick(fx)).toMatchObject({
      ok: true,
      instance: { componentName: "Card", section: "card" },
      designSelection: null,
      designSelectionUnavailable: "same-file-nesting",
    });
  });

  it("reverse check: without the guard the same click confirms the outer instance", async () => {
    const fx = await fixture(SLOT_NESTED);
    const result = await verifyCardClick(fx);
    // Every other step passed: the guard runs last, after file and digest.
    expect(result).toMatchObject({
      ok: true,
      designSelectionUnavailable: "same-file-nesting",
    });
    if (!result.ok) throw new Error("unreachable");
    const outer = { start: result.identity.start, end: result.identity.end };
    const input = nestingInput(fx);
    expect(astroSameFileNestingRisk(input, outer, CARD)).toBe(true);
    // The guard without the unmarked inner Card would let it through.
    expect(
      astroSameFileNestingRisk(
        {
          ...input,
          elements: input.elements.filter((element) => !element.slotted),
        },
        outer,
        CARD,
      ),
    ).toBe(false);
    // A different component in the same place leaves the selection on.
    const other = await fixture(
      astroPage(HOME, '<Card {...card}><Hero slot="inner" title="x" /></Card>'),
    );
    expect(await verifyCardClick(other)).toMatchObject({
      ok: true,
      instance: { section: "card" },
      designSelection: { componentPath: CARD },
      designSelectionUnavailable: null,
    });
  });

  it("refuses when a same-file candidate inside the range went unmarked (defence in depth)", async () => {
    // With the six-digit limit a candidate inside a marked one cannot end
    // past ASTRO_BOUNDARY_MAX_OFFSET; the guard still treats any candidate
    // the plugin did not mark as unmarked.
    const fx = await fixture(
      astroPage(HOME, "<Card {...card}><Card title={card.title} /></Card>"),
    );
    expect(fx.markers).toHaveLength(2);
    const outer = parseAstroInstanceIdentity(fx.markers[0])!;
    const input = nestingInput(fx);
    expect(astroSameFileNestingRisk(input, outer, CARD)).toBe(false);
    expect(
      astroSameFileNestingRisk(
        {
          ...input,
          candidates: input.candidates.filter(
            (candidate) => candidate.start === outer.start,
          ),
        },
        outer,
        CARD,
      ),
    ).toBe(true);
    // Marked, the inner Card has its own nearer marker: the outer is safe.
    expect(await verifyCardClick(fx)).toMatchObject({
      ok: true,
      designSelectionUnavailable: null,
    });
  });

  it("refuses when the component renders itself (Astro.self, or an import cycle)", async () => {
    for (const card of [
      "---\nconst { title, depth = 0 } = Astro.props;\n---\n<article><h2>{title}</h2>{depth < 1 && <Astro.self depth={depth + 1} />}</article>\n",
      '---\nimport Wrap from "./Wrap.astro";\nconst { title } = Astro.props;\n---\n<article><h2>{title}</h2><Wrap /></article>\n',
    ]) {
      const fx = await fixture(A6, {
        replace: [{ path: CARD, content: card }],
        extra: [
          {
            path: "src/components/Wrap.astro",
            content:
              '---\nimport Card from "./Card.astro";\n---\n<div><Card title="again" /></div>\n',
          },
        ],
      });
      expect(await verifyCardClick(fx, fx.markers[1])).toMatchObject({
        ok: true,
        instance: { section: "card" },
        designSelection: null,
        designSelectionUnavailable: "same-file-nesting",
      });
    }
  });
});

describe("inputs bound to the snapshot (review follow-ups 2 and 3)", () => {
  it("refuses a template answer of a same-length, one-character edit", async () => {
    const fx = await fixture(A6);
    const edited = A6.replace("{...card}", "{...cart}");
    expect(edited).toHaveLength(A6.length);
    const other = await fixture(edited);
    expect(other.route.template.source.length).toBe(
      fx.route.template.source.length,
    );
    expect(
      await verifyAstroInstanceIdentity({
        marker: fx.markers[0],
        snapshot: fx.snapshot,
        route: { ...fx.route, template: other.route.template },
      }),
    ).toMatchObject({ ok: false, reason: "analysis-inconsistent" });
  });

  it("refuses a snapshot that names one file under two paths, in every reader", async () => {
    const fx = await fixture(A6);
    const snapshot = {
      files: [
        ...fx.snapshot.files,
        { path: `./${HERO}`, content: "<p>another Hero</p>\n" },
      ],
    };
    expect(
      await verifyAstroInstanceIdentity({
        marker: fx.markers[0],
        snapshot,
        route: fx.route,
      }),
    ).toMatchObject({ ok: false, reason: "analysis-inconsistent" });
    expect(await astroBindingViewIdentities(snapshot, fx.route)).toEqual([]);
  });
});

/** Two different short strings with equal FNV-1a state after `prefix`. */
function fnvCollidingSuffixes(prefix: string): [string, string] {
  let state = 0x811c9dc5;
  for (let i = 0; i < prefix.length; i++) {
    state ^= prefix.charCodeAt(i);
    state = Math.imul(state, 0x01000193) >>> 0;
  }
  // Scrambled counters, not nested loops: FNV keeps strings that differ
  // only in their last characters apart, so a lexicographic walk finds a
  // collision late. A birthday search over mixed inputs takes ~10^5 tries.
  const seen = new Map<number, string>();
  for (let counter = 1; counter < 4_000_000; counter++) {
    const text = (Math.imul(counter, 0x9e3779b1) >>> 0).toString(36);
    let hash = state;
    for (let i = 0; i < text.length; i++) {
      hash ^= text.charCodeAt(i);
      hash = Math.imul(hash, 0x01000193) >>> 0;
    }
    const other = seen.get(hash);
    if (other !== undefined && other !== text) return [other, text];
    seen.set(hash, text);
  }
  throw new Error("no collision found");
}
