/**
 * The native `.astro` fixtures of Astro M2 D3 (Astro acceptance coverage
 * equal to Start's): the binding shapes of Start's B1 cases
 * (`binding-acceptance-cases.ts`, `binding-acceptance-b1-cases.ts`) written
 * as an Astro author writes them, read in the frontmatter with
 * `morph.pages.get`.
 *
 * One module for the container specs (`e2e/astro-inspector-write.spec.ts`,
 * `e2e/astro-design-release-acceptance.spec.ts`) and the DAL test that holds
 * Core's binding view of these very pages (`storefront-theme.dal.astro-d3.test.ts`),
 * so a fixture that does not bind the way a case assumes fails in Vitest,
 * not after a container run.
 *
 * Every case seeds the same text into every field (the equal-text trap of
 * Start's cases): an edit can only be told apart from its neighbours by
 * where it lands.
 */
export type AstroD3File = Readonly<{ path: string; content: string }>;

export const D3_HERO_PATH = "src/components/Hero.astro";
export const D3_HERO_FIELDS_PATH = "src/components/Hero.fields.ts";
export const D3_HERO_REF = D3_HERO_PATH;
export const D3_DEFAULT_TITLE = "D3-DEFAULT-TITLE";
export const D3_DEFAULT_DESC = "D3-DEFAULT-DESC";

/** The one component of every case: two declared text fields. */
export const D3_HERO = `---
interface Props {
  title?: string;
  desc?: string;
}

const { title = "${D3_DEFAULT_TITLE}", desc = "${D3_DEFAULT_DESC}" } =
  Astro.props;
---
<section data-d3-hero>
  <h1>{title}</h1>
  <p>{desc}</p>
</section>
`;

export const d3HeroFields = (titleLabel = "Title", descLabel = "Desc") =>
  `export const contentFields = {
  title: { type: "text", label: "${titleLabel}" },
  desc: { type: "text", label: "${descLabel}" },
} as const;
`;

const page = (frontmatter: string, body: string) => `---
import { morph } from "@morph/sdk/astro";
import Hero from "../components/Hero.astro";

${frontmatter}
---
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <title>D3</title>
  </head>
  <body>
    <main>
${body}
    </main>
  </body>
</html>
`;

const wrap = (id: string, element: string) =>
  `      <div data-d3-case="${id}">${element}</div>`;

/**
 * Group 1, the editable shapes (D3 rows 2-4, 12, 17):
 *
 * - `p1` field-wise props (Start p1, row 2);
 * - `p2` cross-name alias, `const { desc: heading } = p2` passed as
 *   `title={heading}`: the h1 shows `p2.desc` and an edit writes `desc`
 *   (Start p2, row 3); `title` is not passed, so the stored title is no
 *   field of this page;
 * - `c3` renamed destructuring, `const { title: heading, desc: body }`
 *   (Start c3, row 3);
 * - `c4a` a literal before the spread, the stored section holding the key:
 *   the spread's value shows and is editable (Start c4a, row 4);
 * - `/about`: two instances of Hero with the same text, a spread and a
 *   field-wise one, bound to `teamA` and `teamB` (Start c5/p5, rows 12, 17).
 */
export const D3_HOME_SECTIONS = ["p1", "p2", "c3", "c4a"] as const;
export const D3_ABOUT_SECTIONS = ["teamA", "teamB"] as const;
export const D3_C4A_LITERAL = "Code literal C4a";

export const d3HomePage = () =>
  page(
    `const home = await morph.pages.get("/");
const { p1, p2, c3, c4a } = home;
const { desc: heading } = p2;
const { title: c3Heading, desc: c3Body } = c3;`,
    [
      wrap("p1", "<Hero title={p1.title} desc={p1.desc} />"),
      wrap("p2", "<Hero title={heading} />"),
      wrap("c3", "<Hero title={c3Heading} desc={c3Body} />"),
      wrap("c4a", `<Hero title="${D3_C4A_LITERAL}" {...c4a} />`),
    ].join("\n"),
  );

export const d3AboutPage = () =>
  page(
    `const about = await morph.pages.get("/about");
const { teamA, teamB } = about;`,
    [
      wrap("teamA", "<Hero {...teamA} />"),
      wrap("teamB", "<Hero title={teamB.title} desc={teamB.desc} />"),
    ].join("\n"),
  );

/**
 * Group 2, the shapes Design must not write (D3 rows 5-9), on `/refused`.
 * Each but `c6a` keeps one editable sibling (`desc`):
 *
 * - `p4a` a literal before the spread, the stored section with no `title`:
 *   the literal shows and `title` is controlled by code (Start p4a, row 5);
 * - `p3` the spread then a literal holding the stored text (Start p3,
 *   row 6);
 * - `c6a` literals only: no section, no field (Start c6a, row 7);
 * - `p6` a value through author code, `opaque(p6.title)` (Start p6, row 8);
 * - `r9` a value the page passes itself, a frontmatter constant (Start's
 *   "a field the route passes marks it controlled by code", row 9).
 *
 * `literal` is the text the literals show: the same as the stored text.
 */
export const D3_REFUSED_PATH = "/refused";
export const D3_REFUSED_SECTIONS = ["p4a", "p3", "p6", "r9"] as const;
export const D3_P4A_LITERAL = "Code literal P4a";

export const d3RefusedPage = (literal: string) =>
  page(
    `const refused = await morph.pages.get("${D3_REFUSED_PATH}");
const { p4a, p3, p6, r9 } = refused;
const opaque = (value: string | undefined) => value;
const pageTitle = ${JSON.stringify(literal)};`,
    [
      wrap("p4a", `<Hero title="${D3_P4A_LITERAL}" {...p4a} />`),
      wrap("p3", `<Hero {...p3} title=${JSON.stringify(literal)} />`),
      wrap("p6", "<Hero title={opaque(p6.title)} desc={p6.desc} />"),
      wrap("r9", "<Hero title={pageTitle} desc={r9.desc} />"),
      wrap(
        "c6a",
        `<Hero title=${JSON.stringify(literal)} desc=${JSON.stringify(literal)} />`,
      ),
    ].join("\n"),
  );

/**
 * The fields Core proves for each section of these pages, as the binding
 * view names them (stored field, and `requiresOwnKey` where the claim holds
 * only while the stored section has the key). `c6a` renders no section.
 */
export const D3_EXPECTED_CLAIMS: Readonly<
  Record<string, readonly Readonly<{ field: string; requiresOwnKey?: true }>[]>
> = {
  p1: [{ field: "desc" }, { field: "title" }],
  p2: [{ field: "desc" }],
  c3: [{ field: "desc" }, { field: "title" }],
  c4a: [{ field: "desc" }, { field: "title", requiresOwnKey: true }],
  teamA: [{ field: "desc" }, { field: "title" }],
  teamB: [{ field: "desc" }, { field: "title" }],
  p4a: [{ field: "desc" }, { field: "title", requiresOwnKey: true }],
  p3: [{ field: "desc" }],
  p6: [{ field: "desc" }],
  r9: [{ field: "desc" }],
};

/** Group 3 (D3 row 30): one page, `<Hero {...card} />`, on a Theme of its own. */
export const d3SidecarPage = () =>
  page(
    `const home = await morph.pages.get("/");
const { card } = home;`,
    wrap("card", "<Hero {...card} />"),
  );

/** The release sequence (D3 rows 21-23, 24 page isolation). */
export const d3ReleaseHomePage = () =>
  page(
    `const home = await morph.pages.get("/");
const { hero } = home;`,
    wrap("hero", "<Hero {...hero} />"),
  );

export const d3ReleaseAboutPage = () =>
  page(
    `const about = await morph.pages.get("/about");
const { team } = about;`,
    wrap("team", "<Hero {...team} />"),
  );

/** A stored section row as Core writes one for a Hero instance. */
export const d3Row = (id: string, props: Record<string, unknown>) => ({
  id,
  type: "hero",
  componentRef: D3_HERO_REF,
  enabled: true,
  props,
});

/**
 * Batch 2 (D3 rows 14, 18, 24's layout half): an Astro layout every page
 * renders inside, as an Astro author writes one. The layout reads the
 * request's page with `morph.pages.get(Astro.url.pathname)`; Core answers a
 * path with the layout Document's sections and the page's own, so the
 * layout's `banner` comes from the layout Document on every page. Each page
 * keeps one section of its own inside the layout's slot.
 */
export const D3_SHELL_PATH = "src/layouts/Shell.astro";

export const d3Shell = () => `---
import { morph } from "@morph/sdk/astro";
import Hero from "../components/Hero.astro";

const shell = await morph.pages.get(Astro.url.pathname);
const { banner } = shell;
---
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <title>D3 layout</title>
  </head>
  <body>
    <header data-d3-case="banner"><Hero {...banner} /></header>
    <main>
      <slot />
    </main>
  </body>
</html>
`;

/** A page inside the layout, with its own section `section` spread. */
export const d3ShellPage = (path: string, section: string) => `---
import { morph } from "@morph/sdk/astro";
import Hero from "../components/Hero.astro";
import Shell from "../layouts/Shell.astro";

const content = await morph.pages.get(${JSON.stringify(path)});
const { ${section} } = content;
---
<Shell>
  <div data-d3-case="${section}"><Hero {...${section}} /></div>
</Shell>
`;
