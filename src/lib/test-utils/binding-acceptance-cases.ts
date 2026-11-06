/**
 * The binding acceptance case set (ROADMAP 1.2, "綁定驗收規範", draft rule in
 * PR #284), first round: one Hero component with two declared fields, six
 * route shapes, each read from a real stored Document.
 *
 * Shared by the live (vitest) layer and the editor E2E layer, so both measure
 * the same source, the same stored content and the same targets. Pure data:
 * nothing here imports product code.
 *
 * The targets are the rule's, not today's behaviour:
 *
 * - `field`: the element shows exactly one stored field, so a click must
 *   locate that section and field, and an edit must write only it.
 * - `literal`: the element shows text written in the code. It is not CMS data:
 *   it must never be claimed as a stored field and never written.
 * - `composed`: the element shows text composed from stored fields. The raw
 *   fields should be located for editing, and the composed text must never be
 *   written back.
 *
 * Equal-text traps are deliberate. Different fields hold the same text
 * ("SALE"): `title` and `desc` of one section, `heroA.title` and
 * `heroB.title`, and a literal "SALE" next to stored "SALE" fields. A system
 * that binds by matching text is caught by these.
 *
 * Multi-hop passing (Hero -> Heading) and Astro are not in this round. A pass
 * here is a React pass, not a cross-framework pass.
 */

export const BAS_HERO_PATH = "src/components/BasHero.tsx";

export const BAS_HERO_DEFAULT_TITLE = "Hero default title";
export const BAS_HERO_DEFAULT_DESC = "Hero default desc";

export const BAS_HERO_LABELS = {
  title: "Hero title",
  desc: "Hero desc",
} as const;

export const BAS_HERO_SOURCE = `export const contentFields = {
  title: { type: "text", label: "${BAS_HERO_LABELS.title}" },
  desc: { type: "text", label: "${BAS_HERO_LABELS.desc}" },
} as const;

type BasHeroProps = { title?: string; desc?: string };

export default function BasHero({
  title = "${BAS_HERO_DEFAULT_TITLE}",
  desc = "${BAS_HERO_DEFAULT_DESC}",
}: BasHeroProps) {
  return (
    <section className="px-6 py-10">
      <h1 className="text-2xl font-semibold">{title}</h1>
      <p className="mt-2">{desc}</p>
    </section>
  );
}
`;

/** How the route reads its page. */
export type BasSpelling =
  /** `content("slot")`: what the default client-only Live Preview can run. */
  | "content"
  /** server function -> loader -> `Route.useLoaderData()`: full Start. */
  | "loader";

export type StoredProps = Readonly<Record<string, string>>;
export type StoredSections = Readonly<Record<string, StoredProps>>;

export type BasTarget =
  | Readonly<{ kind: "field"; section: string; field: "title" | "desc" }>
  | Readonly<{ kind: "literal" }>
  | Readonly<{ kind: "untraced" }>
  | Readonly<{
      kind: "composed";
      section: string;
      rawFields: readonly ("title" | "desc")[];
    }>;

export type BasElement = Readonly<{
  /** `h1` or `p`, and which one inside the case's root, in document order. */
  tag: "h1" | "p";
  nth: number;
  /** What the element must show, given the stored sections. */
  text: (stored: StoredSections) => string;
  target: BasTarget;
}>;

export type BasEdit = Readonly<{
  /** The element the author works on. */
  element: number;
  /**
   * The Inspector edit the target calls for: the field (by its declared key)
   * the author changes, and where it must land. For a literal there is none.
   */
  inspector:
    | Readonly<{ section: string; field: "title" | "desc" }>
    | null;
  /**
   * Whether typing on the canvas over this element may write: true for a
   * direct field, false for a literal or composed text.
   */
  inlineWrites: boolean;
}>;

export type BasCase = Readonly<{
  id: string;
  /** A separately authored component for acceptance outside the original Hero fixture. */
  component?: Readonly<{
    name: string;
    path: string;
    source: string;
    labels: Readonly<Record<"title" | "desc", string>>;
  }>;
  /** What the case verifies (the user's table). */
  verifies: string;
  routePath: string;
  routeFile: string;
  /** Sections the route reads, in order; the seed route renders each once. */
  slots: readonly string[];
  seed: StoredSections;
  /** The component body, per spelling. `hero` etc. are the slot locals. */
  body: Readonly<Record<BasSpelling, string>>;
  elements: readonly BasElement[];
  edit: BasEdit;
  /**
   * Set for sections the root layout renders on every page. They are stored
   * in the Theme's one layout Document, not a route's; `body` is the layout
   * component's body (it renders `{children}`, and reads its slots with
   * `content()` in both spellings, as the starter layout does: the root
   * route's `beforeLoad` loads them in full Start too). Every element must
   * show the same on each of `pages`, the home page first; `routePath` and
   * `routeFile` are that first page's.
   */
  layout?: Readonly<{
    path: string;
    pages: readonly Readonly<{ routePath: string; routeFile: string }>[];
  }>;
}>;

const contentLocals = (slots: readonly string[]) =>
  slots.map((slot) => `  const ${slot} = content("${slot}");`).join("\n");

const SALE = "SALE";

/** A stored value, or a marker that says it is not stored (content lost). */
const v = (s: StoredSections, section: string, field: string) =>
  s[section]?.[field] ?? `(${section}.${field} not stored)`;

export const BAS_CASES: readonly BasCase[] = [
  {
    id: "c1",
    verifies: "the supported control: a spread of one section",
    routePath: "/bas-c1",
    routeFile: "src/routes/bas-c1.tsx",
    slots: ["hero"],
    seed: { hero: { title: SALE, desc: SALE } },
    body: {
      loader: `  return (
    <main data-bas-case="c1">
      <BasHero {...hero} />
    </main>
  );`,
      content: `  return (
    <main data-bas-case="c1">
      <BasHero {...content("hero")} />
    </main>
  );`,
    },
    elements: [
      {
        tag: "h1",
        nth: 0,
        text: (s) => v(s, "hero", "title"),
        target: { kind: "field", section: "hero", field: "title" },
      },
      {
        tag: "p",
        nth: 0,
        text: (s) => v(s, "hero", "desc"),
        target: { kind: "field", section: "hero", field: "desc" },
      },
    ],
    edit: {
      element: 0,
      inspector: { section: "hero", field: "title" },
      inlineWrites: true,
    },
  },
  {
    id: "c2",
    verifies: "top-level per-field props",
    routePath: "/bas-c2",
    routeFile: "src/routes/bas-c2.tsx",
    slots: ["hero"],
    seed: { hero: { title: SALE, desc: SALE } },
    body: {
      loader: `  const { title, desc } = hero;
  return (
    <main data-bas-case="c2">
      <BasHero title={title} desc={desc} />
    </main>
  );`,
      content: `${contentLocals(["hero"])}
  const { title, desc } = hero;
  return (
    <main data-bas-case="c2">
      <BasHero title={title} desc={desc} />
    </main>
  );`,
    },
    elements: [
      {
        tag: "h1",
        nth: 0,
        text: (s) => v(s, "hero", "title"),
        target: { kind: "field", section: "hero", field: "title" },
      },
      {
        tag: "p",
        nth: 0,
        text: (s) => v(s, "hero", "desc"),
        target: { kind: "field", section: "hero", field: "desc" },
      },
    ],
    edit: {
      element: 0,
      inspector: { section: "hero", field: "title" },
      inlineWrites: true,
    },
  },
  {
    id: "c3",
    verifies: "renamed destructuring: the source is not guessed from names",
    routePath: "/bas-c3",
    routeFile: "src/routes/bas-c3.tsx",
    slots: ["hero"],
    seed: { hero: { title: SALE, desc: SALE } },
    body: {
      loader: `  const { title: heading, desc: body } = hero;
  return (
    <main data-bas-case="c3">
      <BasHero title={heading} desc={body} />
    </main>
  );`,
      content: `${contentLocals(["hero"])}
  const { title: heading, desc: body } = hero;
  return (
    <main data-bas-case="c3">
      <BasHero title={heading} desc={body} />
    </main>
  );`,
    },
    elements: [
      {
        tag: "h1",
        nth: 0,
        text: (s) => v(s, "hero", "title"),
        target: { kind: "field", section: "hero", field: "title" },
      },
      {
        tag: "p",
        nth: 0,
        text: (s) => v(s, "hero", "desc"),
        target: { kind: "field", section: "hero", field: "desc" },
      },
    ],
    // The renamed `body` is the one edited: `desc` reaches the component
    // under a name that is neither the slot's nor the prop's.
    edit: {
      element: 1,
      inspector: { section: "hero", field: "desc" },
      inlineWrites: true,
    },
  },
  {
    id: "c4a",
    verifies:
      "a literal before the spread: the spread's value is used and recognised",
    routePath: "/bas-c4a",
    routeFile: "src/routes/bas-c4a.tsx",
    slots: ["hero"],
    seed: { hero: { title: SALE, desc: SALE } },
    body: {
      loader: `  return (
    <main data-bas-case="c4a">
      <BasHero title="Code literal C4a" {...hero} />
    </main>
  );`,
      content: `  return (
    <main data-bas-case="c4a">
      <BasHero title="Code literal C4a" {...content("hero")} />
    </main>
  );`,
    },
    elements: [
      {
        tag: "h1",
        nth: 0,
        text: (s) => v(s, "hero", "title"),
        target: { kind: "field", section: "hero", field: "title" },
      },
      {
        tag: "p",
        nth: 0,
        text: (s) => v(s, "hero", "desc"),
        target: { kind: "field", section: "hero", field: "desc" },
      },
    ],
    edit: {
      element: 0,
      inspector: { section: "hero", field: "title" },
      inlineWrites: true,
    },
  },
  {
    id: "c4b",
    verifies:
      "a prop after the spread wins: other.title is used; hero.title is not claimed",
    routePath: "/bas-c4b",
    routeFile: "src/routes/bas-c4b.tsx",
    slots: ["hero", "other"],
    // Equal-text trap: the overridden hero.title holds the same text.
    seed: {
      hero: { title: SALE, desc: "C4b hero desc" },
      other: { title: SALE, desc: "C4b other desc" },
    },
    body: {
      loader: `  return (
    <main data-bas-case="c4b">
      <BasHero {...hero} title={other.title} />
    </main>
  );`,
      content: `${contentLocals(["other"])}
  return (
    <main data-bas-case="c4b">
      <BasHero {...content("hero")} title={other.title} />
    </main>
  );`,
    },
    elements: [
      {
        tag: "h1",
        nth: 0,
        text: (s) => v(s, "other", "title"),
        target: { kind: "field", section: "other", field: "title" },
      },
      {
        tag: "p",
        nth: 0,
        text: (s) => v(s, "hero", "desc"),
        target: { kind: "field", section: "hero", field: "desc" },
      },
    ],
    edit: {
      element: 0,
      inspector: { section: "other", field: "title" },
      inlineWrites: true,
    },
  },
  {
    id: "c5",
    verifies: "two instances bound to different sections stay distinct",
    routePath: "/bas-c5",
    routeFile: "src/routes/bas-c5.tsx",
    slots: ["heroA", "heroB"],
    // Equal-text trap: both titles hold the same text.
    seed: {
      heroA: { title: SALE, desc: "C5 A desc" },
      heroB: { title: SALE, desc: "C5 B desc" },
    },
    body: {
      loader: `  return (
    <main data-bas-case="c5">
      <BasHero {...heroA} />
      <BasHero {...heroB} />
    </main>
  );`,
      content: `  return (
    <main data-bas-case="c5">
      <BasHero {...content("heroA")} />
      <BasHero {...content("heroB")} />
    </main>
  );`,
    },
    elements: [
      {
        tag: "h1",
        nth: 0,
        text: (s) => v(s, "heroA", "title"),
        target: { kind: "field", section: "heroA", field: "title" },
      },
      {
        tag: "p",
        nth: 0,
        text: (s) => v(s, "heroA", "desc"),
        target: { kind: "field", section: "heroA", field: "desc" },
      },
      {
        tag: "h1",
        nth: 1,
        text: (s) => v(s, "heroB", "title"),
        target: { kind: "field", section: "heroB", field: "title" },
      },
      {
        tag: "p",
        nth: 1,
        text: (s) => v(s, "heroB", "desc"),
        target: { kind: "field", section: "heroB", field: "desc" },
      },
    ],
    // The second instance is edited; the first, holding the same text, must
    // come through untouched.
    edit: {
      element: 2,
      inspector: { section: "heroB", field: "title" },
      inlineWrites: true,
    },
  },
  {
    id: "c6a",
    verifies:
      "literal text is not CMS data: never claimed, never written",
    routePath: "/bas-c6",
    routeFile: "src/routes/bas-c6.tsx",
    slots: ["promo", "sale"],
    // Equal-text trap: the literal "SALE" next to stored "SALE" fields.
    seed: {
      promo: { title: "C6 promo stored title", desc: SALE },
      sale: { title: "Summer", desc: SALE },
    },
    body: {
      loader: C6_LOADER_BODY(),
      content: `${contentLocals(["promo", "sale"])}
${C6_JSX()}`,
    },
    elements: C6_ELEMENTS(),
    edit: { element: 0, inspector: null, inlineWrites: false },
  },
  {
    id: "c6b",
    verifies:
      "composed text: raw fields located, composed text never written back",
    routePath: "/bas-c6",
    routeFile: "src/routes/bas-c6.tsx",
    slots: ["promo", "sale"],
    seed: {
      promo: { title: "C6 promo stored title", desc: SALE },
      sale: { title: "Summer", desc: SALE },
    },
    body: {
      loader: C6_LOADER_BODY(),
      content: `${contentLocals(["promo", "sale"])}
${C6_JSX()}`,
    },
    elements: C6_ELEMENTS(),
    // The Inspector edits the raw `sale.title`; typing over the composed
    // heading must write nothing.
    edit: {
      element: 2,
      inspector: { section: "sale", field: "title" },
      inlineWrites: false,
    },
  },
];

function C6_JSX() {
  return `  return (
    <main data-bas-case="c6">
      <BasHero title="${SALE}" desc={promo.desc} />
      <BasHero title={\`\${sale.title} \${sale.desc}\`} desc="Limited time" />
    </main>
  );`;
}

function C6_LOADER_BODY() {
  return C6_JSX();
}

function C6_ELEMENTS(): readonly BasElement[] {
  return [
    {
      tag: "h1",
      nth: 0,
      text: () => SALE,
      target: { kind: "literal" },
    },
    {
      tag: "p",
      nth: 0,
      text: (s) => v(s, "promo", "desc"),
      target: { kind: "field", section: "promo", field: "desc" },
    },
    {
      tag: "h1",
      nth: 1,
      text: (s) => `${v(s, "sale", "title")} ${v(s, "sale", "desc")}`,
      target: { kind: "composed", section: "sale", rawFields: ["title", "desc"] },
    },
    {
      tag: "p",
      nth: 1,
      text: () => "Limited time",
      target: { kind: "literal" },
    },
  ];
}

/** The route as the case writes it, in one spelling, at `pagePath`. */
export function basRouteSource(
  testCase: BasCase,
  spelling: BasSpelling,
  options: Readonly<{ routePath?: string; seed?: boolean }> = {},
): string {
  const componentName = testCase.component?.name ?? "BasHero";
  const routePath = options.routePath ?? testCase.routePath;
  const body = options.seed
    ? seedBody(testCase, spelling)
    : testCase.body[spelling];
  if (spelling === "content") {
    return `import { createFileRoute } from "@tanstack/react-router";
import { content } from "../morph/content";
import ${componentName} from "../components/${componentName}";

export const Route = createFileRoute("${routePath}")({
  component: BasRoute,
});

function BasRoute() {
${body}
}
`;
  }
  return `import { createFileRoute } from "@tanstack/react-router";
import { createServerFn } from "@tanstack/react-start";
import { morph } from "../morph/content";
import ${componentName} from "../components/${componentName}";

const getPage = createServerFn().handler(() => morph.pages.get("${routePath}"));

export const Route = createFileRoute("${routePath}")({
  loader: () => getPage(),
  component: BasRoute,
});

function BasRoute() {
  const { ${testCase.slots.join(", ")} } = Route.useLoaderData();
${body}
}
`;
}

/**
 * The root layout a layout case writes, in its case shape or (with `seed`)
 * with each slot spread once, the shape the product binds.
 */
export function basLayoutSource(
  testCase: BasCase,
  options: Readonly<{ seed?: boolean }> = {},
): string {
  const componentName = testCase.component?.name ?? "BasHero";
  const body = options.seed
    ? `  return (
    <div>
      <header data-bas-case="${testCase.id}-seed">
${testCase.slots
  .map((slot) => `        <${componentName} {...content("${slot}")} />`)
  .join("\n")}
      </header>
      {children}
    </div>
  );`
    : testCase.body.content;
  return `import type { ReactNode } from "react";
import { content } from "../morph/content";
import ${componentName} from "../components/${componentName}";

export default function StorefrontLayout({ children }: { children?: ReactNode }) {
${body}
}
`;
}

/** A page with no sections of its own, for a layout case to be seen on. */
export function basPlainPageSource(routePath: string): string {
  return `import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("${routePath}")({
  component: BasPlainPage,
});

function BasPlainPage() {
  return <main data-bas-page="${routePath}">Plain page</main>;
}
`;
}

/**
 * The route every slot is first stored through: each section spread once,
 * the supported shape, so the seed goes through the product's own write path
 * (authorization, OCC, source confirmation) before the case's shape replaces
 * it. Writing Theme source never writes stored content.
 */
function seedBody(testCase: BasCase, spelling: BasSpelling): string {
  const componentName = testCase.component?.name ?? "BasHero";
  const heroes = testCase.slots
    .map((slot) =>
      spelling === "content"
        ? `      <${componentName} {...content("${slot}")} />`
        : `      <${componentName} {...${slot}} />`,
    )
    .join("\n");
  return `  return (
    <main data-bas-case="${testCase.id}-seed">
${heroes}
    </main>
  );`;
}

/** Cases sharing one route (C6a, C6b) are seeded and written once. */
export function basRoutes(): readonly BasCase[] {
  const seen = new Set<string>();
  return BAS_CASES.filter((testCase) => {
    if (seen.has(testCase.routePath)) return false;
    seen.add(testCase.routePath);
    return true;
  });
}

/** The root element a case renders, by its `data-bas-case`. */
export function basCaseRootId(testCase: BasCase): string {
  return testCase.id.startsWith("c6") ? "c6" : testCase.id;
}

type StoredSection = Readonly<{
  id: string;
  props?: Readonly<Record<string, unknown>>;
}> &
  Readonly<Record<string, unknown>>;

export type StoredDocument = Readonly<{
  sections: readonly StoredSection[];
}> &
  Readonly<Record<string, unknown>>;

/** `{ sectionId: props }` of a stored Document, string props only. */
export function storedSectionsOf(document: StoredDocument): StoredSections {
  return Object.fromEntries(
    document.sections.map((section) => [
      section.id,
      Object.fromEntries(
        Object.entries(section.props ?? {}).filter(
          (entry): entry is [string, string] => typeof entry[1] === "string",
        ),
      ),
    ]),
  );
}

/**
 * Every difference between two stored Documents other than the one expected
 * change, in words; empty when only that changed (or, with no change
 * expected, when nothing did). Sections are compared as serialized JSON, so
 * "unchanged" means byte-identical, not merely equal-looking.
 */
export function unexpectedDocumentChanges(
  before: StoredDocument,
  after: StoredDocument,
  change: Readonly<{ section: string; field: string; value: string }> | null,
): string[] {
  const problems: string[] = [];
  const afterById = new Map(after.sections.map((s) => [s.id, s] as const));
  const beforeIds = before.sections.map((s) => s.id);
  const afterIds = after.sections.map((s) => s.id);
  for (const id of beforeIds) {
    if (!afterById.has(id)) problems.push(`section "${id}" was deleted`);
  }
  for (const id of afterIds) {
    if (!beforeIds.includes(id)) problems.push(`section "${id}" was added`);
  }
  if (
    problems.length === 0 &&
    JSON.stringify(beforeIds) !== JSON.stringify(afterIds)
  ) {
    problems.push(
      `section order changed: ${JSON.stringify(beforeIds)} -> ${JSON.stringify(afterIds)}`,
    );
  }
  for (const section of before.sections) {
    const next = afterById.get(section.id);
    if (!next) continue;
    if (!change || change.section !== section.id) {
      if (JSON.stringify(section) !== JSON.stringify(next)) {
        problems.push(
          `section "${section.id}" changed: ${JSON.stringify(section)} -> ${JSON.stringify(next)}`,
        );
      }
      continue;
    }
    const { props: beforeProps = {}, ...beforeRest } = section;
    const { props: afterProps = {}, ...afterRest } = next;
    if (JSON.stringify(beforeRest) !== JSON.stringify(afterRest)) {
      problems.push(
        `section "${section.id}" changed outside its props: ${JSON.stringify(beforeRest)} -> ${JSON.stringify(afterRest)}`,
      );
    }
    const keys = new Set([
      ...Object.keys(beforeProps),
      ...Object.keys(afterProps),
    ]);
    for (const key of keys) {
      const was = (beforeProps as Record<string, unknown>)[key];
      const is = (afterProps as Record<string, unknown>)[key];
      if (key === change.field) {
        if (is !== change.value) {
          problems.push(
            `"${section.id}.${key}" is ${JSON.stringify(is)}, not the edited ${JSON.stringify(change.value)}`,
          );
        }
      } else if (JSON.stringify(was) !== JSON.stringify(is)) {
        problems.push(
          `"${section.id}.${key}" changed: ${JSON.stringify(was)} -> ${JSON.stringify(is)}`,
        );
      }
    }
  }
  if (change && !afterById.has(change.section)) {
    problems.push(`the edited section "${change.section}" is not stored`);
  }
  return problems;
}
