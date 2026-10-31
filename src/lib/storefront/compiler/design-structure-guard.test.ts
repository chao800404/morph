import { describe, expect, it } from "vitest";
import { livePreviewPlatformFiles } from "@/lib/test-utils/live-preview-render";
import {
  DESIGN_STRUCTURE_UNKNOWN_MESSAGE,
  judgeDesignStructureWrite,
} from "./design-structure-guard";
import { reorderThemeRouteSections } from "./theme-route-sections";

/**
 * The Design structure capability guard on its own (the server runs it on
 * one snapshot). Fixture: the 2B case of
 * theme-route-structure-dependency-lock.test.ts, where the route's lock
 * follows its loader's module while the route file stays the same.
 */
const ROUTE = "src/routes/index.tsx";
const DATA = "src/server/home.ts";
const LOCKED = /reads its content through its route loader/;

const fields = (name: string) => `export const contentFields = {
  title: { type: "text", label: "Title" },
};
export default function ${name}({ title = "Default title" }: any) {
  return <section><h1>{title}</h1></section>;
}`;

const ROUTE_SOURCE = `import { createFileRoute } from "@tanstack/react-router";
import { content } from "../morph/content";
import Hero from "../components/sections/Hero";
import Banner from "../components/sections/Banner";
import Promo from "../components/sections/Promo";
import { getHome } from "../server/home";

export const Route = createFileRoute("/")({
  loader: () => getHome(),
  component: Home,
});

function Home() {
  const page = Route.useLoaderData();
  return (
    <main>
      <Hero {...content("hero")} />
      <Banner {...content("banner")} />
      <Promo {...page.promo} />
    </main>
  );
}`;

/** The loader returns a plain object: not this page, the route is open. */
const DATA_OPEN = `import { createServerFn } from "@tanstack/react-start";
export const getHome = createServerFn().handler(() => ({ promo: { title: "Static" } }));`;
/** The loader returns this page: the route is locked. */
const DATA_LOCKED = `import { createServerFn } from "@tanstack/react-start";
import { morph } from "../morph/content";
export const getHome = createServerFn().handler(() => morph.pages.get("/"));`;

const theme = (data: string, route = ROUTE_SOURCE) => [
  ...livePreviewPlatformFiles(),
  { path: "src/components/sections/Hero.tsx", content: fields("Hero") },
  { path: "src/components/sections/Banner.tsx", content: fields("Banner") },
  { path: "src/components/sections/Promo.tsx", content: fields("Promo") },
  { path: DATA, content: data },
  { path: ROUTE, content: route },
];

/** The reorder Design computes while the route is open. */
function reordered() {
  const result = reorderThemeRouteSections(
    ROUTE_SOURCE,
    theme(DATA_OPEN),
    ROUTE,
    ["banner", "hero"],
  );
  if (!result.changed) throw new Error("fixture: the reorder is refused");
  return result.code;
}

describe("the Design structure capability guard", () => {
  it("lets a structure write to an open route through", () => {
    expect(
      judgeDesignStructureWrite(
        theme(DATA_OPEN),
        [{ path: ROUTE, content: reordered() }],
        [],
      ),
    ).toEqual({ ok: true });
  });

  it("refuses a structure write to a route whose stored source is locked", () => {
    expect(
      judgeDesignStructureWrite(
        theme(DATA_LOCKED),
        [{ path: ROUTE, content: reordered() }],
        [],
      ),
    ).toMatchObject({
      ok: false,
      error: "DESIGN_STRUCTURE_LOCKED",
      message: expect.stringMatching(LOCKED),
      path: ROUTE,
    });
  });

  it("refuses a write that would leave the route locked, though the stored source is open", () => {
    expect(
      judgeDesignStructureWrite(
        theme(DATA_OPEN),
        [
          { path: ROUTE, content: reordered() },
          { path: DATA, content: DATA_LOCKED },
        ],
        [],
      ),
    ).toMatchObject({
      ok: false,
      error: "DESIGN_STRUCTURE_LOCKED",
      path: ROUTE,
    });
  });

  it("refuses a write that changes what locks the route in the same batch: it cannot unlock it for itself", () => {
    expect(
      judgeDesignStructureWrite(
        theme(DATA_LOCKED),
        [
          { path: ROUTE, content: reordered() },
          { path: DATA, content: DATA_OPEN },
        ],
        [],
      ),
    ).toMatchObject({
      ok: false,
      error: "DESIGN_STRUCTURE_LOCKED",
      path: ROUTE,
    });
  });

  it("refuses a write that deletes what locks the route in the same batch", () => {
    expect(
      judgeDesignStructureWrite(
        theme(DATA_LOCKED),
        [{ path: ROUTE, content: reordered() }],
        [DATA],
      ),
    ).toMatchObject({
      ok: false,
      error: "DESIGN_STRUCTURE_LOCKED",
      path: ROUTE,
    });
  });

  /** A route at `path` whose loader reads this page through its own module. */
  const ownRoute = (path: string, dataModule: string) =>
    ROUTE_SOURCE.replace(
      'createFileRoute("/")',
      `createFileRoute("${path}")`,
    ).replace('from "../server/home"', `from "../server/${dataModule}"`);
  const ownData = (path: string) =>
    DATA_LOCKED.replace('morph.pages.get("/")', `morph.pages.get("${path}")`);

  it("judges a new route on what it would be: locked through its loader, it is refused", () => {
    const NEW_ROUTE = "src/routes/landing.tsx";
    expect(
      judgeDesignStructureWrite(
        theme(DATA_OPEN),
        [
          { path: "src/server/landing.ts", content: ownData("/landing") },
          { path: NEW_ROUTE, content: ownRoute("/landing", "landing") },
        ],
        [],
      ),
    ).toMatchObject({
      ok: false,
      error: "DESIGN_STRUCTURE_LOCKED",
      path: NEW_ROUTE,
    });
    // The same new route, its loader reading something else: open.
    expect(
      judgeDesignStructureWrite(
        theme(DATA_OPEN),
        [
          { path: "src/server/landing.ts", content: DATA_OPEN },
          { path: NEW_ROUTE, content: ownRoute("/landing", "landing") },
        ],
        [],
      ),
    ).toEqual({ ok: true });
  });

  it("judges every source file a write changes, not only the first", () => {
    const OTHER = "src/routes/other.tsx";
    const stored = [
      ...theme(DATA_OPEN),
      { path: "src/server/other.ts", content: ownData("/other") },
      { path: OTHER, content: ownRoute("/other", "other") },
    ];
    expect(
      judgeDesignStructureWrite(
        stored,
        [
          // The first file, an open route: allowed on its own.
          { path: ROUTE, content: reordered() },
          // The second, locked through its own loader.
          {
            path: OTHER,
            content: `${ownRoute("/other", "other")}
// touched
`,
          },
        ],
        [],
      ),
    ).toMatchObject({
      ok: false,
      error: "DESIGN_STRUCTURE_LOCKED",
      path: OTHER,
    });
  });

  it("refuses a write it cannot analyse", () => {
    expect(
      judgeDesignStructureWrite(
        theme(DATA_OPEN),
        [{ path: ROUTE, content: `${reordered()}\nfunction (` }],
        [],
      ),
    ).toEqual({
      ok: false,
      error: "DESIGN_STRUCTURE_UNKNOWN",
      message: DESIGN_STRUCTURE_UNKNOWN_MESSAGE,
      path: ROUTE,
    });
  });

  it("does not judge files that are not source", () => {
    expect(
      judgeDesignStructureWrite(
        theme(DATA_OPEN),
        [{ path: "src/styles.css", content: "{ not js" }],
        [],
      ),
    ).toEqual({ ok: true });
  });
});
