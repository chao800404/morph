import { describe, expect, it } from "vitest";
import type {
  AstroRouteBindingInstance,
  AstroRouteBindingsView,
} from "../source-language/astro-route-bindings";
import { ASTRO_BASIS_UNCONFIRMED_MESSAGE } from "./astro-basis-presentation";
import {
  ASTRO_SELECTION_RECHECKING_MESSAGE,
  astroBasisUnconfirmedHint,
  astroDesignNoticeOf,
  rederiveAstroDesignSelection,
  stepAstroDesignFocus,
  type AstroDesignFocus,
  type ConfirmedAstroDesignSelection,
} from "./astro-design-focus";

// Lead decisions Q2/Q3 (handoff/2026-11-24/astro-basis-hints.md): an
// unconfirmed Astro basis is said where the section is (the Inspector top and
// the section's row), not in a toast; and after a new document the selection
// is re-derived from Core's binding view, never kept from the old frame.

const NONCE = "0123456789abcdef";
const SRC = "a".repeat(64);
const DIGEST = "c".repeat(64);
const MARKER = `${NONCE}:2:${SRC}:30:60`;

function instance(
  overrides: Partial<AstroRouteBindingInstance> = {},
): AstroRouteBindingInstance {
  return {
    identity: { rule: 2, src: SRC, start: 30, end: 60 },
    componentDigest: DIGEST,
    componentPath: "src/components/Hero.astro",
    componentName: "Hero",
    section: "hero",
    componentRef: "src/components/Hero.astro#default",
    sectionType: "hero",
    declaredFields: ["title"],
    claims: [{ slot: "hero", field: "title" }],
    ...overrides,
  };
}

function view(
  overrides: Partial<AstroRouteBindingsView> = {},
): AstroRouteBindingsView {
  return {
    routePath: "/",
    routeFile: "src/pages/index.astro",
    sourceGeneration: 3,
    routeSourceDigest: SRC,
    boundaryRule: 2,
    status: { kind: "confirmed" },
    instances: [instance()],
    ...overrides,
  };
}

const SELECTION: ConfirmedAstroDesignSelection = {
  status: "confirmed",
  sectionId: "hero",
  identity: MARKER,
  componentDigest: DIGEST,
  componentRef: "src/components/Hero.astro#default",
  sectionType: "hero",
  declaredFields: ["title"],
  fields: ["title"],
  ownKeyFields: [],
};

/** The focus a confirmed click starts; a `selected` step always gives one. */
const selected = (): AstroDesignFocus => {
  const focus = stepAstroDesignFocus(null, {
    kind: "selected",
    selection: SELECTION,
  });
  if (focus === null) throw new Error("a selected step gave no focus");
  return focus;
};

describe("rederiveAstroDesignSelection", () => {
  const args = (v: AstroRouteBindingsView | null) => ({
    selection: SELECTION,
    view: v,
    workspaceSourceGeneration: 3,
    routePath: "/",
  });

  it("keeps the selection when Core's new view has the same instance exactly", () => {
    expect(rederiveAstroDesignSelection(args(view()))).toEqual(SELECTION);
  });

  it("takes the section Core now binds the instance to, not the old one", () => {
    const result = rederiveAstroDesignSelection(
      args(
        view({
          instances: [
            instance({
              section: "hero-2",
              claims: [{ slot: "hero-2", field: "title" }],
            }),
          ],
        }),
      ),
    );
    expect(result).toMatchObject({ status: "confirmed", sectionId: "hero-2" });
  });

  it("refuses when the instance moved (another range)", () => {
    const result = rederiveAstroDesignSelection(
      args(
        view({
          instances: [
            instance({ identity: { rule: 2, src: SRC, start: 31, end: 61 } }),
          ],
        }),
      ),
    );
    expect(result).toMatchObject({
      status: "refused",
      hint: { action: "reload-preview" },
    });
  });

  it("refuses when Core's component digest for the instance changed", () => {
    const result = rederiveAstroDesignSelection(
      args(view({ instances: [instance({ componentDigest: "d".repeat(64) })] })),
    );
    expect(result.status).toBe("refused");
  });

  it("refuses a view of another source generation than the workspace's", () => {
    const result = rederiveAstroDesignSelection(
      args(view({ sourceGeneration: 4 })),
    );
    expect(result).toMatchObject({
      status: "refused",
      hint: { reason: "source-stale" },
    });
  });

  it("is still checking without a view", () => {
    expect(rederiveAstroDesignSelection(args(null))).toEqual({
      status: "checking",
    });
  });
});

describe("stepAstroDesignFocus", () => {
  it("a confirmed selection starts with nothing to say", () => {
    expect(selected()).toEqual({
      selection: SELECTION,
      hint: null,
      rederiving: false,
    });
    expect(astroDesignNoticeOf(selected())).toBeNull();
  });

  it("an unconfirmed basis for the selected section is a class A hint on it", () => {
    const focus = stepAstroDesignFocus(selected(), {
      kind: "basis-unconfirmed",
      sectionId: "hero",
      reason: "other-ticket",
    });
    expect(focus?.hint).toEqual(astroBasisUnconfirmedHint("other-ticket"));
    expect(astroDesignNoticeOf(focus)).toEqual({
      sectionId: "hero",
      tone: "unconfirmed",
      message: ASTRO_BASIS_UNCONFIRMED_MESSAGE,
      badge: "Reload preview",
      action: "reload-preview",
    });
  });

  it("an unconfirmed basis for another section says nothing", () => {
    const focus = selected();
    expect(
      stepAstroDesignFocus(focus, {
        kind: "basis-unconfirmed",
        sectionId: "banner",
        reason: "other-ticket",
      }),
    ).toBe(focus);
    expect(
      stepAstroDesignFocus(null, {
        kind: "basis-unconfirmed",
        sectionId: "hero",
        reason: "other-ticket",
      }),
    ).toBeNull();
  });

  it("an acknowledged basis clears its hint", () => {
    const held = stepAstroDesignFocus(selected(), {
      kind: "basis-unconfirmed",
      sectionId: "hero",
      reason: "not-applied-section-missing",
    });
    const focus = stepAstroDesignFocus(held, {
      kind: "basis-acknowledged",
      sectionId: "hero",
    });
    expect(focus?.hint).toBeNull();
    expect(astroDesignNoticeOf(focus)).toBeNull();
  });

  it("a new document drops the hint and waits for Core's view", () => {
    const held = stepAstroDesignFocus(selected(), {
      kind: "basis-unconfirmed",
      sectionId: "hero",
      reason: "other-ticket",
    });
    const focus = stepAstroDesignFocus(held, { kind: "document-replaced" });
    expect(focus).toEqual({
      selection: SELECTION,
      hint: null,
      rederiving: true,
    });
    expect(astroDesignNoticeOf(focus)).toEqual({
      sectionId: "hero",
      tone: "checking",
      message: ASTRO_SELECTION_RECHECKING_MESSAGE,
      badge: "Checking…",
      action: null,
    });
    // An unconfirmed basis from the old document is not said meanwhile.
    expect(
      stepAstroDesignFocus(focus, {
        kind: "basis-unconfirmed",
        sectionId: "hero",
        reason: "other-ticket",
      }),
    ).toBe(focus);
  });

  it("a new document with no selection forgets an earlier cleared hint", () => {
    const cleared: AstroDesignFocus = {
      selection: null,
      hint: astroBasisUnconfirmedHint("other-ticket"),
      rederiving: false,
    };
    expect(stepAstroDesignFocus(cleared, { kind: "document-replaced" })).toBeNull();
    expect(stepAstroDesignFocus(null, { kind: "document-replaced" })).toBeNull();
  });

  it("re-derived and confirmed: the selection is Core's again", () => {
    const waiting = stepAstroDesignFocus(selected(), {
      kind: "document-replaced",
    });
    const moved = { ...SELECTION, sectionId: "hero-2" };
    expect(
      stepAstroDesignFocus(waiting, {
        kind: "rederived",
        identity: MARKER,
        result: moved,
      }),
    ).toEqual({ selection: moved, hint: null, rederiving: false });
  });

  it("re-derived and refused: the selection clears, with the hint", () => {
    const waiting = stepAstroDesignFocus(selected(), {
      kind: "document-replaced",
    });
    const hint = {
      class: "temporarily-unconfirmable" as const,
      reason: "preview-identity-mismatch",
      action: "reload-preview" as const,
      message: "reload",
    };
    const focus = stepAstroDesignFocus(waiting, {
      kind: "rederived",
      identity: MARKER,
      result: { status: "refused", hint },
    });
    expect(focus).toEqual({ selection: null, hint, rederiving: false });
    expect(astroDesignNoticeOf(focus)).toEqual({
      sectionId: null,
      tone: "unconfirmed",
      message: "reload",
      badge: "Reload preview",
      action: "reload-preview",
    });
  });

  it("re-derived without a view: the selection clears (fail closed)", () => {
    const waiting = stepAstroDesignFocus(selected(), {
      kind: "document-replaced",
    });
    const focus = stepAstroDesignFocus(waiting, {
      kind: "rederived",
      identity: MARKER,
      result: { status: "checking" },
    });
    expect(focus?.selection).toBeNull();
    expect(focus?.hint).toMatchObject({
      class: "temporarily-unconfirmable",
      reason: "binding-view-unread",
      action: "reload-preview",
    });
  });

  it("a re-derive answer for another selection, or after one, is ignored", () => {
    const waiting = stepAstroDesignFocus(selected(), {
      kind: "document-replaced",
    });
    expect(
      stepAstroDesignFocus(waiting, {
        kind: "rederived",
        identity: `${NONCE}:2:${SRC}:90:120`,
        result: { status: "checking" },
      }),
    ).toBe(waiting);
    const settled = selected();
    expect(
      stepAstroDesignFocus(settled, {
        kind: "rederived",
        identity: MARKER,
        result: { status: "checking" },
      }),
    ).toBe(settled);
  });

  it("deselected forgets everything", () => {
    expect(stepAstroDesignFocus(selected(), { kind: "deselected" })).toBeNull();
  });
});
