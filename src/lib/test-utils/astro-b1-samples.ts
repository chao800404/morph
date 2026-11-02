/**
 * The `.astro` B1 sample set: the M2 projection experiment's samples
 * (exp/m2-astro-projection 9cb01f0 + aeae249,
 * ~/handoff/2026-11-02/astro-projection-experiment-results.json), ported as
 * the regression set for the product projection and the Astro profile.
 *
 * `expected` is the Astro profile's answer, handwritten, never derived from
 * the analysis. It is the experiment's observed result, except where the
 * Astro profile is deliberately stricter or the experiment found a defect the
 * product now fixes:
 *
 * - N3, N4, N5: a call site under any expression container never claims a
 *   field on Astro (D90-3). Start claims these (its `isDirectPosition` looks
 *   at the JSX parent only) and stays as it is; see `ASTRO_STRICTER_THAN_START`.
 * - F3: the built-in `<Fragment>` is not an instance (D90-5); the experiment
 *   reported it as one.
 *
 * `twin` is an equivalent Start route, where one is easy to write.
 */
export type AstroB1Summary = Readonly<{
  name: string;
  section: string | null;
  /** Sorted `slot.field` claims. */
  claims: readonly string[];
}>;

export type AstroB1Sample = Readonly<{
  id: string;
  title: string;
  routeFile: string;
  source: string;
  /** Expected instances, or `refused` when the parser must refuse it. */
  expected: readonly AstroB1Summary[] | "refused";
  twin?: string;
}>;

const IMPORTS =
  'import Hero from "../components/Hero.astro";\n' +
  'import Card from "../components/Card.astro";\n' +
  'import Layout from "../components/Layout.astro";\n' +
  'import * as UI from "../components/ui";\n' +
  'import { morph } from "@morph/sdk/astro";\n';

const HOME =
  'const home = await morph.pages.get("/");\nconst { hero, card } = home;\n';

export const astroPage = (frontmatter: string, template: string) =>
  `---\n${IMPORTS}${frontmatter}---\n${template}\n`;

export const startTwin = (body: string, jsx: string, routePath = "/") =>
  'import { createFileRoute } from "@tanstack/react-router";\n' +
  'import { morph } from "../morph/content";\n' +
  'import Hero from "../components/Hero";\n' +
  'import Card from "../components/Card";\n' +
  `export const Route = createFileRoute(${JSON.stringify(routePath)})({ component: Page });\n` +
  `async function Page() {\n${body}return <>${jsx}</>;\n}\n`;

const crlf = (text: string) => text.replace(/\r?\n/g, "\r\n");

export const HERO_BOTH: AstroB1Summary = {
  name: "Hero",
  section: "hero",
  claims: ["hero.desc", "hero.title"],
};
export const HERO_NONE: AstroB1Summary = {
  name: "Hero",
  section: "hero",
  claims: [],
};
const CARD_BOTH: AstroB1Summary = {
  name: "Card",
  section: "card",
  claims: ["card.title"],
};
const CARD_UNBOUND: AstroB1Summary = {
  name: "Card",
  section: null,
  claims: [],
};

const INDEX = "src/pages/index.astro";
const COND = "const cond = Math.random() > 0.5;\n";
const ITEMS = 'const items = [{ title: "a" }];\n';

export const MANIFEST = JSON.stringify({
  components: {
    hero: {
      source: "src/components/Hero.astro",
      contentFields: {
        title: { type: "text", label: "Title" },
        desc: { type: "text", label: "Description" },
      },
    },
    card: {
      source: "src/components/Card.astro",
      contentFields: { title: { type: "text", label: "Title" } },
    },
    fragment: {
      source: "src/components/Fragment.astro",
      contentFields: { title: { type: "text", label: "Title" } },
    },
  },
});

/** The Astro Theme around the page under test. No `src/morph/content.ts`. */
export const ASTRO_FIXTURE: readonly Readonly<{
  path: string;
  content: string;
}>[] = [
  { path: "morph.theme.json", content: MANIFEST },
  {
    path: "src/components/Hero.astro",
    content:
      "---\nconst { title, desc } = Astro.props;\n---\n<section><h1>{title}</h1><p>{desc}</p></section>\n",
  },
  {
    path: "src/components/Card.astro",
    content:
      "---\nconst { title } = Astro.props;\n---\n<article><h2>{title}</h2></article>\n",
  },
  {
    path: "src/components/Fragment.astro",
    content: "---\nconst { title } = Astro.props;\n---\n<b>{title}</b>\n",
  },
  {
    path: "src/components/Layout.astro",
    content: '<main><slot name="main" /><slot /></main>\n',
  },
  { path: "src/components/Badge.astro", content: "<span>badge</span>\n" },
  {
    path: "src/components/ui.ts",
    content: 'export { default as Badge } from "./Badge.astro";\n',
  },
];

/** The equivalent Start Theme, for the TSX twins. */
export const START_FIXTURE: readonly Readonly<{
  path: string;
  content: string;
}>[] = [
  { path: "src/morph/content.ts", content: "export const morph = {} as any;" },
  {
    path: "src/components/Hero.tsx",
    content:
      'export const contentFields = { title: { type: "text", label: "Title" }, desc: { type: "text", label: "Description" } } as const;\n' +
      'export default function Hero({ title = "", desc = "" }) { return <section><h1>{title}</h1><p>{desc}</p></section>; }\n',
  },
  {
    path: "src/components/Card.tsx",
    content:
      'export const contentFields = { title: { type: "text", label: "Title" } } as const;\n' +
      'export default function Card({ title = "" }) { return <article><h2>{title}</h2></article>; }\n',
  },
];

/**
 * Samples whose Astro claims are deliberately fewer than their Start twin's
 * (D90-3): what Start claims there, for the explicit comparison.
 */
export const ASTRO_STRICTER_THAN_START: Readonly<
  Record<string, readonly AstroB1Summary[]>
> = {
  N3: [HERO_BOTH],
  N4: [HERO_BOTH],
  N5: [HERO_BOTH],
};

export const ASTRO_B1_SAMPLES: readonly AstroB1Sample[] = [
  {
    id: "A1",
    title: "ROADMAP case: pages.get + destructure + {...hero}",
    routeFile: INDEX,
    source: astroPage(HOME, "<Hero {...hero} />"),
    expected: [HERO_BOTH],
    twin: startTwin(HOME, "<Hero {...hero} />"),
  },
  {
    id: "A2",
    title: "alias destructuring { hero: h }",
    routeFile: INDEX,
    source: astroPage(
      'const home = await morph.pages.get("/");\nconst { hero: h } = home;\n',
      "<Hero {...h} />",
    ),
    expected: [HERO_BOTH],
    twin: startTwin(
      'const home = await morph.pages.get("/");\nconst { hero: h } = home;\n',
      "<Hero {...h} />",
    ),
  },
  {
    id: "A3",
    title:
      "/about per-field props, two instances of one component, no cross-claim",
    routeFile: "src/pages/about.astro",
    source: astroPage(
      'const about = await morph.pages.get("/about");\n',
      "<Hero title={about.intro.title} desc={about.intro.desc} />\n<Hero title={about.team.title} desc={about.team.desc} />",
    ),
    expected: [
      { name: "Hero", section: "intro", claims: ["intro.desc", "intro.title"] },
      { name: "Hero", section: "team", claims: ["team.desc", "team.title"] },
    ],
    twin: startTwin(
      'const about = await morph.pages.get("/about");\n',
      "<Hero title={about.intro.title} desc={about.intro.desc} /><Hero title={about.team.title} desc={about.team.desc} />",
      "/about",
    ),
  },
  {
    id: "A4",
    title: "one slot spread into two instances",
    routeFile: INDEX,
    source: astroPage(HOME, "<Hero {...hero} />\n<Hero {...hero} />"),
    expected: [
      { name: "Hero", section: null, claims: [] },
      { name: "Hero", section: null, claims: [] },
    ],
    twin: startTwin(HOME, "<Hero {...hero} /><Hero {...hero} />"),
  },
  {
    id: "A5",
    title: "index route reading /about's page object",
    routeFile: INDEX,
    source: astroPage(
      'const page = await morph.pages.get("/about");\nconst { hero } = page;\n',
      "<Hero {...hero} />",
    ),
    expected: [HERO_NONE],
    twin: startTwin(
      'const page = await morph.pages.get("/about");\nconst { hero } = page;\n',
      "<Hero {...hero} />",
    ),
  },
  {
    id: "A6",
    title: "two slots, two components",
    routeFile: INDEX,
    source: astroPage(HOME, "<Hero {...hero} />\n<Card {...card} />"),
    expected: [HERO_BOTH, CARD_BOTH],
    twin: startTwin(HOME, "<Hero {...hero} /><Card {...card} />"),
  },
  {
    id: "N1",
    title: "{cond && <Hero {...hero}/>}",
    routeFile: INDEX,
    source: astroPage(HOME + COND, "{cond && <Hero {...hero} />}"),
    expected: [HERO_NONE],
    twin: startTwin(HOME + COND, "{cond && <Hero {...hero} />}"),
  },
  {
    id: "N2",
    title: "{items.map((i) => <Card {...i}/>)}",
    routeFile: INDEX,
    source: astroPage(HOME + ITEMS, "{items.map((i) => <Card {...i} />)}"),
    expected: [CARD_UNBOUND],
    twin: startTwin(HOME + ITEMS, "{items.map((i) => <Card {...i} />)}"),
  },
  {
    id: "N3",
    title: "conditional with a host wrapper: {cond && <div><Hero/></div>}",
    routeFile: INDEX,
    source: astroPage(HOME + COND, "{cond && <div><Hero {...hero} /></div>}"),
    expected: [HERO_NONE],
    twin: startTwin(HOME + COND, "{cond && <div><Hero {...hero} /></div>}"),
  },
  {
    id: "N4",
    title: "loop with a host wrapper: {items.map(() => <div><Hero/></div>)}",
    routeFile: INDEX,
    source: astroPage(
      HOME + ITEMS,
      "{items.map(() => <div><Hero {...hero} /></div>)}",
    ),
    expected: [HERO_NONE],
    twin: startTwin(
      HOME + ITEMS,
      "{items.map(() => <div><Hero {...hero} /></div>)}",
    ),
  },
  {
    id: "N5",
    title: "IIFE with return: {(() => { return <Hero/>; })()}",
    routeFile: INDEX,
    source: astroPage(HOME, "{(() => { return <Hero {...hero} />; })()}"),
    expected: [HERO_NONE],
    twin: startTwin(HOME, "{(() => { return <Hero {...hero} />; })()}"),
  },
  {
    id: "S1",
    title: "hero shadowed by a map parameter",
    routeFile: INDEX,
    source: astroPage(
      HOME + ITEMS,
      "<Hero {...hero} />\n{items.map((hero) => <Card {...hero} />)}",
    ),
    expected: [HERO_BOTH, CARD_UNBOUND],
    twin: startTwin(
      HOME + ITEMS,
      "<Hero {...hero} />{items.map((hero) => <Card {...hero} />)}",
    ),
  },
  {
    id: "S2",
    title: "home shadowed in an inner function",
    routeFile: INDEX,
    source: astroPage(
      HOME,
      '<Hero {...hero} />\n{(() => { const home = { hero: { title: "x" } }; return <Card {...home.hero} />; })()}',
    ),
    expected: [HERO_BOTH, CARD_UNBOUND],
    twin: startTwin(
      HOME,
      '<Hero {...hero} />{(() => { const home = { hero: { title: "x" } }; return <Card {...home.hero} />; })()}',
    ),
  },
  {
    id: "S3",
    title: "morph shadowed by an inner parameter",
    routeFile: INDEX,
    source: astroPage(
      HOME,
      '<Hero {...hero} />\n{((morph) => <Card {...morph.pages.get("/").card} />)({ pages: { get: () => ({}) } })}',
    ),
    expected: [HERO_BOTH, CARD_UNBOUND],
    twin: startTwin(
      HOME,
      '<Hero {...hero} />{((morph) => <Card {...morph.pages.get("/").card} />)({ pages: { get: () => ({}) } })}',
    ),
  },
  {
    id: "S4",
    title: "morph escapes into a call in the template (page root tainted)",
    routeFile: INDEX,
    source: astroPage(HOME, "<Hero {...hero} />\n<p>{String(morph)}</p>"),
    expected: [HERO_NONE],
    twin: startTwin(HOME, "<Hero {...hero} /><p>{String(morph)}</p>"),
  },
  {
    id: "S5",
    title: "hero.title assigned inside a template expression",
    routeFile: INDEX,
    source: astroPage(
      HOME,
      '{(hero.title = "changed", "")}\n<Hero {...hero} />',
    ),
    expected: [HERO_NONE],
    twin: startTwin(HOME, '{(hero.title = "changed", "")}<Hero {...hero} />'),
  },
  {
    id: "S6",
    title:
      "Astro shadowed by a frontmatter function parameter (no Astro root on a page)",
    routeFile: INDEX,
    source: astroPage(
      HOME + "function pick(Astro) { return Astro.props; }\n",
      "<Hero {...hero} />",
    ),
    expected: [HERO_BOTH],
  },
  {
    id: "S6b",
    title: "Astro redeclared at frontmatter level",
    routeFile: INDEX,
    source: astroPage(
      HOME + "const Astro = { props: {} };\n",
      "<Hero {...hero} />",
    ),
    expected: [HERO_BOTH],
  },
  {
    id: "S7",
    title: "hero reassigned",
    routeFile: INDEX,
    source: astroPage(
      'const home = await morph.pages.get("/");\nlet { hero } = home;\nif (Math.random() > 2) hero = { title: "x" };\n',
      "<Hero {...hero} />",
    ),
    expected: [{ name: "Hero", section: null, claims: [] }],
    twin: startTwin(
      'const home = await morph.pages.get("/");\nlet { hero } = home;\nif (Math.random() > 2) hero = { title: "x" };\n',
      "<Hero {...hero} />",
    ),
  },
  {
    id: "F1",
    title: "comments in frontmatter and template",
    routeFile: INDEX,
    source: astroPage(
      "// 註解 line comment\n" + HOME + "/* block\n comment */\n",
      "<!-- html comment -->\n{/* jsx comment */}\n<Hero {...hero} />\n<!-- after -->",
    ),
    expected: [HERO_BOTH],
  },
  {
    id: "F2",
    title: "multiple root elements",
    routeFile: INDEX,
    source: astroPage(
      HOME,
      "<header>h</header>\n<Hero {...hero} />\n<footer>f</footer>",
    ),
    expected: [HERO_BOTH],
    twin: startTwin(
      HOME,
      "<header>h</header><Hero {...hero} /><footer>f</footer>",
    ),
  },
  {
    id: "F3",
    title: "<Fragment> wrapper (built-in, not an instance)",
    routeFile: INDEX,
    source: astroPage(HOME, "<Fragment><Hero {...hero} /></Fragment>"),
    expected: [HERO_BOTH],
  },
  {
    id: "F4",
    title: "class:list, set:html, element spread on a host element",
    routeFile: INDEX,
    source: astroPage(
      HOME,
      '<div class:list={["a", { b: true }]} set:html={hero.desc} {...hero}></div>\n<Hero class:list={["x"]} {...hero} />',
    ),
    expected: [HERO_BOTH],
  },
  {
    id: "F5",
    title: "shorthand attribute {title}",
    routeFile: INDEX,
    source: astroPage(HOME + "const { title } = hero;\n", "<Hero {title} />"),
    expected: [{ name: "Hero", section: "hero", claims: ["hero.title"] }],
  },
  {
    id: "F6",
    title: "backtick attribute value",
    routeFile: INDEX,
    source: astroPage(HOME, "<Hero title=`${hero.title}!` />"),
    expected: [HERO_NONE],
  },
  {
    id: "F7",
    title: "multi-line nested JSX in a conditional, code after it",
    routeFile: INDEX,
    source: astroPage(
      HOME + COND,
      "{cond\n  ? <Card\n      {...card}\n    />\n  : <Hero\n      {...hero} />}\n<p>{cond ? 1 : 2}</p>",
    ),
    expected: [{ name: "Card", section: "card", claims: [] }, HERO_NONE],
  },
  {
    id: "U1",
    title: "CRLF + Chinese + emoji before and between components",
    routeFile: INDEX,
    source: crlf(
      astroPage(
        "// 中文註解 🎉😀\n" + HOME + COND + 'const label = "標題🎉";\n',
        '<p>中文🎉 {"text"}</p>\n<Hero {...hero} />\n<p>{label}😀😀 混合 {"🎉"}</p>\n<Card {...card} />\n<p>{cond && <span>中文🎉{label}</span>}</p>',
      ),
    ),
    expected: [HERO_BOTH, CARD_BOTH],
  },
  {
    id: "U2",
    title: "astral characters inside attribute strings and expressions (LF)",
    routeFile: INDEX,
    source: astroPage(
      HOME + 'const e = "😀";\n',
      '<p title="🎉🎉">{e + "😀"}</p>\n<Hero data-x="🎉🎉" {...hero} />\n<Card title={card.title} data-e={`😀${e}`} />',
    ),
    expected: [HERO_BOTH, CARD_BOTH],
  },
  {
    id: "I1",
    title: "member component, named slot inside a Layout",
    routeFile: INDEX,
    source: astroPage(
      HOME,
      '<UI.Badge />\n<Layout>\n<Hero {...hero} slot="main" />\n<Card {...card} />\n</Layout>',
    ),
    expected: [
      { name: "Layout", section: null, claims: [] },
      HERO_BOTH,
      CARD_BOTH,
    ],
  },
  {
    id: "I2",
    title: "member component before two instances of one component",
    routeFile: INDEX,
    source: astroPage(
      HOME,
      "<UI.Badge />\n<Hero {...hero} />\n<Hero {...card} />",
    ),
    expected: [
      HERO_BOTH,
      { name: "Hero", section: "card", claims: ["card.desc", "card.title"] },
    ],
  },
  {
    id: "E1",
    title: "template syntax error (compiler diagnostics)",
    routeFile: INDEX,
    source: astroPage(HOME, "<Hero {...hero} />\n{cond && }"),
    expected: "refused",
  },
];

/** Samples with nested JSX whose ancestors end at the JSX (experiment). */
export const ASTRO_SAMPLES_ENDING_AT_NESTED_JSX = [
  "N1",
  "N2",
  "N3",
  "N4",
  "S1",
  "S3",
  "F7",
  "U1",
] as const;
