/**
 * B1 integration fixtures. Pure data; expected targets are handwritten, not inferred by the analyzer.
 *
 * The first-round acceptance cases (`BAS_CASES`, copied by the Codex probe
 * from test/binding-acceptance-suite 43844f1) plus the B1 shapes the round
 * calls for that the suite does not spell out. Every expected target below is
 * written by hand from what the element shows, never read from an analyser.
 *
 * Equal-text traps: P2 (`title` and `desc` both "SALE", rendered under the
 * other prop's name), P3 (a literal "SALE" over a stored "SALE"), P5 (two
 * instances whose titles are both "SALE").
 */
import {
  BAS_CASES,
  BAS_HERO_DEFAULT_DESC,
  type BasCase,
  type StoredSections,
} from "@/lib/test-utils/binding-acceptance-cases";

const SALE = "SALE";

const v = (s: StoredSections, section: string, field: string) =>
  s[section]?.[field] ?? `(${section}.${field} not stored)`;

const contentLocals = (slots: readonly string[]) =>
  slots.map((slot) => `  const ${slot} = content("${slot}");`).join("\n");

export const B1_EXTRA_CASES: readonly BasCase[] = [
  {
    id: "p1",
    verifies: "member reads: hero.title / hero.desc passed per field",
    routePath: "/b1-p1",
    routeFile: "src/routes/b1-p1.tsx",
    slots: ["hero"],
    seed: { hero: { title: SALE, desc: SALE } },
    body: {
      loader: `  return (
    <main data-bas-case="p1">
      <BasHero title={hero.title} desc={hero.desc} />
    </main>
  );`,
      content: `${contentLocals(["hero"])}
  return (
    <main data-bas-case="p1">
      <BasHero title={hero.title} desc={hero.desc} />
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
      element: 1,
      inspector: { section: "hero", field: "desc" },
      inlineWrites: true,
    },
  },
  {
    id: "p2",
    verifies:
      "cross-name alias: const { desc: heading } = hero passed as title={heading}",
    routePath: "/b1-p2",
    routeFile: "src/routes/b1-p2.tsx",
    slots: ["hero"],
    // Equal-text trap: the h1 shows hero.desc while hero.title holds the same
    // text, and the prop it arrives under is named `title`.
    seed: { hero: { title: SALE, desc: SALE } },
    body: {
      loader: `  const { desc: heading } = hero;
  return (
    <main data-bas-case="p2">
      <BasHero title={heading} />
    </main>
  );`,
      content: `${contentLocals(["hero"])}
  const { desc: heading } = hero;
  return (
    <main data-bas-case="p2">
      <BasHero title={heading} />
    </main>
  );`,
    },
    elements: [
      {
        tag: "h1",
        nth: 0,
        text: (s) => v(s, "hero", "desc"),
        target: { kind: "field", section: "hero", field: "desc" },
      },
      // `desc` is not passed: the component's own default shows. Code, not CMS.
      {
        tag: "p",
        nth: 0,
        text: () => BAS_HERO_DEFAULT_DESC,
        target: { kind: "literal" },
      },
    ],
    edit: {
      element: 0,
      inspector: { section: "hero", field: "desc" },
      inlineWrites: true,
    },
  },
  {
    id: "p3",
    verifies: 'spread then a literal override: {...hero} title="SALE"',
    routePath: "/b1-p3",
    routeFile: "src/routes/b1-p3.tsx",
    slots: ["hero"],
    // Equal-text trap: the literal equals the overridden stored title.
    seed: { hero: { title: SALE, desc: "P3 hero desc" } },
    body: {
      loader: `  return (
    <main data-bas-case="p3">
      <BasHero {...hero} title="${SALE}" />
    </main>
  );`,
      content: `  return (
    <main data-bas-case="p3">
      <BasHero {...content("hero")} title="${SALE}" />
    </main>
  );`,
    },
    elements: [
      { tag: "h1", nth: 0, text: () => SALE, target: { kind: "literal" } },
      {
        tag: "p",
        nth: 0,
        text: (s) => v(s, "hero", "desc"),
        target: { kind: "field", section: "hero", field: "desc" },
      },
    ],
    edit: {
      element: 1,
      inspector: { section: "hero", field: "desc" },
      inlineWrites: true,
    },
  },
  {
    id: "p4a",
    verifies:
      "literal before the spread, stored section has no title: the literal shows and is not claimed",
    routePath: "/b1-p4a",
    routeFile: "src/routes/b1-p4a.tsx",
    slots: ["hero"],
    seed: { hero: { desc: "P4a hero desc" } },
    body: {
      loader: `  return (
    <main data-bas-case="p4a">
      <BasHero title="Code literal P4a" {...hero} />
    </main>
  );`,
      content: `  return (
    <main data-bas-case="p4a">
      <BasHero title="Code literal P4a" {...content("hero")} />
    </main>
  );`,
    },
    elements: [
      {
        tag: "h1",
        nth: 0,
        text: () => "Code literal P4a",
        target: { kind: "literal" },
      },
      {
        tag: "p",
        nth: 0,
        text: (s) => v(s, "hero", "desc"),
        target: { kind: "field", section: "hero", field: "desc" },
      },
    ],
    edit: { element: 0, inspector: null, inlineWrites: false },
  },
  {
    id: "p5",
    verifies: "two per-field instances whose titles hold the same text",
    routePath: "/b1-p5",
    routeFile: "src/routes/b1-p5.tsx",
    slots: ["heroA", "heroB"],
    seed: {
      heroA: { title: SALE, desc: "P5 A desc" },
      heroB: { title: SALE, desc: "P5 B desc" },
    },
    body: {
      loader: `  return (
    <main data-bas-case="p5">
      <BasHero title={heroA.title} desc={heroA.desc} />
      <BasHero title={heroB.title} desc={heroB.desc} />
    </main>
  );`,
      content: `${contentLocals(["heroA", "heroB"])}
  return (
    <main data-bas-case="p5">
      <BasHero title={heroA.title} desc={heroA.desc} />
      <BasHero title={heroB.title} desc={heroB.desc} />
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
    edit: {
      element: 2,
      inspector: { section: "heroB", field: "title" },
      inlineWrites: true,
    },
  },
];

/** Cases formally in scope for B1. c4b and c6b remain explicit gaps. */
const B1_CASE_IDS = new Set([
  "c1", "c2", "c3", "c4a", "c5", "c6a",
]);
export const B1_INTEGRATION_CASES: readonly BasCase[] = [
  ...BAS_CASES.filter((testCase) => B1_CASE_IDS.has(testCase.id)),
  ...B1_EXTRA_CASES,
];
