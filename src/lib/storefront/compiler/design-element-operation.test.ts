import { describe, expect, it } from "vitest";
import {
  applyDesignElementOperation,
  DESIGN_ELEMENT_SECTIONS_MESSAGE,
  DESIGN_ELEMENT_UNDO_NOT_APPLICABLE_MESSAGE,
  resolveDesignElementOperation,
  undoDesignElementEdit,
} from "./design-element-operation";

/**
 * The undo of a Design element edit (decision A, Q2): allowed only when it
 * reverses exactly that edit and touches ordinary elements as the files
 * stand now. The fixture is the one of
 * storefront-theme-files-design-element-resend.test.ts: a wrapper around
 * `<PromoCard />`, which is GuardBanner's row component — until another
 * file drops the row field, and PromoCard's call site becomes a section.
 */
const sectionComponent = (
  name: string,
  extraFields = "",
) => `export const contentFields = {
  title: { type: "text", label: "${name} title" },${extraFields}
} as const;

export default function ${name}({ title = "${name} default" }: { title?: string }) {
  return (
    <section>
      <h2>{title}</h2>
    </section>
  );
}
`;
const ROUTE = "src/routes/guard.tsx";
const BANNER = "src/components/sections/GuardBanner.tsx";
const ROUTE_SOURCE = `import { createFileRoute } from "@tanstack/react-router";
import { content } from "../morph/content";
import GuardHero from "../components/sections/GuardHero";
import GuardBanner from "../components/sections/GuardBanner";
import PromoCard from "../components/sections/PromoCard";

export const Route = createFileRoute("/guard")({
  component: GuardRoute,
});

function GuardRoute() {
  return (
    <main>
      <div className="stack">
        <GuardHero {...content("hero")} />
        <GuardBanner {...content("banner")} />
      </div>
      <aside className="promo">
        <PromoCard />
      </aside>
      <p className="note">Plain note</p>
    </main>
  );
}
`;
function keyOf(source: string, needle: string) {
  const index = source.indexOf(needle);
  if (index < 0) throw new Error(`fixture: ${needle} not found`);
  const before = source.slice(0, index);
  return `${before.split("\n").length}:${index - before.lastIndexOf("\n")}`;
}
const REMOVE_PROMO = {
  kind: "remove-element",
  targetKey: keyOf(ROUTE_SOURCE, '<aside className="promo">'),
} as const;
const REMOVE_NOTE = {
  kind: "remove-element",
  targetKey: keyOf(ROUTE_SOURCE, '<p className="note">'),
} as const;

const files = (banner: string, route = ROUTE_SOURCE) => [
  {
    path: "src/components/sections/GuardHero.tsx",
    content: sectionComponent("GuardHero"),
  },
  { path: BANNER, content: banner },
  {
    path: "src/components/sections/PromoCard.tsx",
    content: sectionComponent("PromoCard"),
  },
  { path: ROUTE, content: route },
];
const WITH_ROWS = sectionComponent(
  "GuardBanner",
  `\n  items: { type: "array", label: "Items", of: "./PromoCard" },`,
);
const WITHOUT_ROWS = sectionComponent("GuardBanner");

/** The route after `edit`, as Design saved it while PromoCard was a row. */
function edited(edit: typeof REMOVE_PROMO | typeof REMOVE_NOTE) {
  const result = applyDesignElementOperation(
    files(WITH_ROWS),
    ROUTE,
    ROUTE_SOURCE,
    edit,
  );
  if (result.status !== "ok") throw new Error("fixture: the edit is refused");
  return result.code;
}

describe("the undo of a Design element edit", () => {
  it("puts the file back when the edit, applied to the restored text, gives the stored file", () => {
    const stored = edited(REMOVE_PROMO);
    expect(
      undoDesignElementEdit(
        files(WITH_ROWS, stored),
        ROUTE,
        stored,
        ROUTE_SOURCE,
        REMOVE_PROMO,
      ),
    ).toEqual({ status: "ok", code: ROUTE_SOURCE });
  });

  it("is refused when what it would bring back now holds a section call site", () => {
    // Another file dropped the row field since: restoring the wrapper would
    // add PromoCard's call site, now a section, back to the page.
    const stored = edited(REMOVE_PROMO);
    expect(
      undoDesignElementEdit(
        files(WITHOUT_ROWS, stored),
        ROUTE,
        stored,
        ROUTE_SOURCE,
        REMOVE_PROMO,
      ),
    ).toMatchObject({
      status: "refused",
      error: "DESIGN_ELEMENT_TOUCHES_SECTIONS",
      message: DESIGN_ELEMENT_SECTIONS_MESSAGE,
    });
  });

  it("is refused when the stored file is not what the edit made of the restored text", () => {
    // The stored file changed after the edit (here: a second element gone).
    const stored = applyDesignElementOperation(
      files(WITH_ROWS),
      ROUTE,
      edited(REMOVE_PROMO),
      {
        kind: "remove-element",
        targetKey: keyOf(edited(REMOVE_PROMO), '<p className="note">'),
      },
    );
    if (stored.status !== "ok") throw new Error("fixture");
    expect(
      undoDesignElementEdit(
        files(WITH_ROWS, stored.code),
        ROUTE,
        stored.code,
        ROUTE_SOURCE,
        REMOVE_PROMO,
      ),
    ).toEqual({
      status: "refused",
      error: "DESIGN_ELEMENT_NOT_APPLICABLE",
      message: DESIGN_ELEMENT_UNDO_NOT_APPLICABLE_MESSAGE,
    });
  });

  it("is refused when the text sent differs from the text the edit was made on outside what it removed", () => {
    const stored = edited(REMOVE_NOTE);
    const other = ROUTE_SOURCE.replace(
      'className="stack"',
      'className="stacked"',
    );
    expect(
      undoDesignElementEdit(
        files(WITH_ROWS, stored),
        ROUTE,
        stored,
        other,
        REMOVE_NOTE,
      ),
    ).toMatchObject({
      status: "refused",
      error: "DESIGN_ELEMENT_NOT_APPLICABLE",
    });
  });

  it("is refused when the element it brings back carries a section call site", () => {
    // What a removed element held cannot be told from the stored file, so the
    // text sent for it is judged as it stands: a section call site inside is
    // refused. (Ordinary content inside it is not a section change, and is
    // not checked further.)
    const stored = edited(REMOVE_NOTE);
    const smuggled = ROUTE_SOURCE.replace(
      '<p className="note">Plain note</p>',
      '<p className="note"><GuardHero {...content("hero")} /></p>',
    );
    expect(
      undoDesignElementEdit(
        files(WITH_ROWS, stored),
        ROUTE,
        stored,
        smuggled,
        REMOVE_NOTE,
      ),
    ).toMatchObject({
      status: "refused",
      error: "DESIGN_ELEMENT_TOUCHES_SECTIONS",
    });
  });

  it("is refused when the current file cannot be analysed", () => {
    const broken = `${edited(REMOVE_NOTE)}\nfunction (`;
    expect(
      undoDesignElementEdit(
        files(WITH_ROWS, broken),
        ROUTE,
        broken,
        ROUTE_SOURCE,
        REMOVE_NOTE,
      ),
    ).toMatchObject({
      status: "refused",
      error: "DESIGN_ELEMENT_EFFECT_UNKNOWN",
    });
  });

  it("resolveDesignElementOperation answers an edit by recomputing it, and an undo by checking it", () => {
    const stored = edited(REMOVE_NOTE);
    expect(
      resolveDesignElementOperation(
        files(WITH_ROWS),
        ROUTE,
        ROUTE_SOURCE,
        stored,
        REMOVE_NOTE,
      ),
    ).toEqual({ status: "ok", code: stored });
    expect(
      resolveDesignElementOperation(
        files(WITH_ROWS, stored),
        ROUTE,
        stored,
        ROUTE_SOURCE,
        { kind: "undo", edit: REMOVE_NOTE },
      ),
    ).toEqual({ status: "ok", code: ROUTE_SOURCE });
  });
});
