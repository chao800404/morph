import { describe, expect, it } from "vitest";
import type {
  AstroRouteBindingInstance,
  AstroRouteBindingsView,
} from "../source-language/astro-route-bindings";
import {
  astroDesignHint,
  astroDesignPageStatus,
  astroWriteIdentity,
  resolveAstroDesignSelection,
  type AstroDesignSelectionRequest,
} from "./astro-design-selection";

// M2 PR-F: what an Astro canvas click becomes once Core's binding view is
// read. Only an exact match with an instance Core confirmed on the same
// source generation and page is a Design selection; everything else is one
// of the plan's §6.2 status hints, and nothing falls back to a name, an
// ordinal or the stored Document.

const NONCE = "0123456789abcdef";
const SRC = "a".repeat(64);
const COMPONENT_DIGEST = "c".repeat(64);
const MARKER = `${NONCE}:2:${SRC}:120:158`;

function instance(
  overrides: Partial<AstroRouteBindingInstance> = {},
): AstroRouteBindingInstance {
  return {
    identity: { rule: 2, src: SRC, start: 120, end: 158 },
    componentDigest: COMPONENT_DIGEST,
    componentPath: "src/components/Hero.astro",
    componentName: "Hero",
    section: "hero",
    componentRef: "src/components/Hero.astro#default",
    sectionType: "hero",
    declaredFields: ["desc", "title"],
    claims: [
      { slot: "hero", field: "desc" },
      { slot: "hero", field: "title" },
    ],
    ...overrides,
  };
}

function view(
  overrides: Partial<AstroRouteBindingsView> = {},
): AstroRouteBindingsView {
  return {
    routePath: "/",
    routeFile: "src/pages/index.astro",
    sourceGeneration: 7,
    routeSourceDigest: SRC,
    boundaryRule: 2,
    status: { kind: "confirmed" },
    instances: [instance()],
    ...overrides,
  };
}

const pending: AstroDesignSelectionRequest = {
  status: "pending-core",
  marker: MARKER,
  sourceLocation: "src/components/Hero.astro:4:1",
  sourceDigest: COMPONENT_DIGEST,
};

const resolve = (
  args: Partial<Parameters<typeof resolveAstroDesignSelection>[0]> = {},
) =>
  resolveAstroDesignSelection({
    request: pending,
    view: view(),
    workspaceSourceGeneration: 7,
    routePath: "/",
    ...args,
  });

describe("resolveAstroDesignSelection", () => {
  it("confirms the instance Core confirmed, with Core's digest and the proven fields", () => {
    expect(resolve()).toEqual({
      status: "confirmed",
      sectionId: "hero",
      identity: MARKER,
      componentDigest: COMPONENT_DIGEST,
      componentRef: "src/components/Hero.astro#default",
      sectionType: "hero",
      declaredFields: ["desc", "title"],
      fields: ["desc", "title"],
      ownKeyFields: [],
    });
  });

  // D3 row 5: the binding view says which claims hold only while the stored
  // section has the key (a literal before the spread); the selection keeps
  // that, so the Inspector can leave them to Code when the key is absent.
  it("keeps the fields a literal before the spread takes only while the section holds them", () => {
    const literalFirst = view({
      instances: [
        instance({
          claims: [
            { slot: "hero", field: "desc" },
            { slot: "hero", field: "title", requiresOwnKey: true },
          ],
        }),
      ],
    });
    expect(resolve({ view: literalFirst })).toMatchObject({
      status: "confirmed",
      fields: ["desc", "title"],
      ownKeyFields: ["title"],
    });
  });

  it("waits while the view is not read yet", () => {
    expect(resolve({ view: null })).toEqual({ status: "checking" });
  });

  it("asks for a reload when the frame is older than the v2 identity", () => {
    const result = resolve({ request: { status: "needs-reload" } });
    expect(result).toMatchObject({
      status: "refused",
      hint: {
        class: "temporarily-unconfirmable",
        reason: "preview-identity-legacy",
        action: "reload-preview",
      },
    });
  });

  it("is no Design selection for a click outside every boundary", () => {
    const result = resolve({
      request: { status: "unavailable", reason: "outside" },
    });
    expect(result).toMatchObject({
      status: "refused",
      hint: { reason: "outside-section", action: "open-code" },
    });
  });

  it("refuses a view of another source generation as stale (A)", () => {
    expect(resolve({ workspaceSourceGeneration: 8 })).toMatchObject({
      status: "refused",
      hint: {
        class: "temporarily-unconfirmable",
        reason: "source-stale",
        action: "reload-preview",
      },
    });
  });

  it("refuses a view of another page", () => {
    expect(resolve({ routePath: "/about" })).toMatchObject({
      status: "refused",
      hint: { class: "temporarily-unconfirmable", reason: "source-stale" },
    });
  });

  it("carries the view's own refusal class and reason", () => {
    const refused = view({
      status: {
        kind: "refused",
        class: "capability-limit",
        reason: "source-too-large",
        detail: "src/pages/index.astro: over the limit",
      },
      instances: [],
    });
    expect(resolve({ view: refused })).toMatchObject({
      status: "refused",
      hint: {
        class: "capability-limit",
        reason: "source-too-large",
        action: "open-code",
      },
    });
  });

  it("refuses an identity no confirmed instance has (no ordinal or name fallback)", () => {
    const other = view({
      instances: [
        instance({ identity: { rule: 2, src: SRC, start: 200, end: 240 } }),
      ],
    });
    expect(resolve({ view: other })).toMatchObject({
      status: "refused",
      hint: {
        class: "temporarily-unconfirmable",
        reason: "preview-identity-mismatch",
        action: "reload-preview",
      },
    });
  });

  it("refuses when the frame's component digest is not Core's", () => {
    expect(
      resolve({ request: { ...pending, sourceDigest: "e".repeat(64) } }),
    ).toMatchObject({
      status: "refused",
      hint: { reason: "preview-identity-mismatch" },
    });
  });

  it("refuses an identity of another boundary rule or route source", () => {
    expect(
      resolve({
        request: { ...pending, marker: `${NONCE}:2:${"b".repeat(64)}:120:158` },
      }),
    ).toMatchObject({ status: "refused", hint: { reason: "preview-identity-mismatch" } });
    expect(
      resolve({ request: { ...pending, marker: `${NONCE}:3:${SRC}:120:158` } }),
    ).toMatchObject({ status: "refused", hint: { reason: "preview-identity-mismatch" } });
  });

  it("is controlled by code (D) when the instance renders no section", () => {
    const unbound = view({ instances: [instance({ section: null, claims: [] })] });
    expect(resolve({ view: unbound })).toMatchObject({
      status: "refused",
      hint: { class: "controlled-by-code", reason: "section-unbound" },
    });
  });

  it("is controlled by code (D) when no declared field is proven from the section", () => {
    const unproven = view({ instances: [instance({ claims: [] })] });
    expect(resolve({ view: unproven })).toMatchObject({
      status: "refused",
      hint: { class: "controlled-by-code", reason: "no-proven-field" },
    });
  });

  it("offers only proven fields that the component declares", () => {
    const partly = view({
      instances: [
        instance({
          declaredFields: ["title"],
          claims: [
            { slot: "hero", field: "title" },
            { slot: "hero", field: "undeclared" },
          ],
        }),
      ],
    });
    expect(resolve({ view: partly })).toMatchObject({
      status: "confirmed",
      fields: ["title"],
    });
  });
});

describe("astroDesignPageStatus", () => {
  it("is checking, confirmed or refused from the view, never from the framework name", () => {
    expect(
      astroDesignPageStatus({
        view: null,
        workspaceSourceGeneration: 7,
        routePath: "/",
      }),
    ).toEqual({ status: "checking" });
    expect(
      astroDesignPageStatus({
        view: view(),
        workspaceSourceGeneration: 7,
        routePath: "/",
      }),
    ).toEqual({ status: "confirmed" });
    expect(
      astroDesignPageStatus({
        view: view(),
        workspaceSourceGeneration: 6,
        routePath: "/",
      }),
    ).toMatchObject({ status: "refused", hint: { reason: "source-stale" } });
  });
});

describe("astroDesignHint", () => {
  it("words binding-missing as this environment, not as a source problem", () => {
    const hint = astroDesignHint("temporarily-unconfirmable", "parser-binding-missing");
    expect(hint.action).toBe("open-code");
    expect(hint.message).toMatch(/environment/i);
    expect(hint.message).toMatch(/Code mode/);
  });

  it("asks to retry a busy parser and to reload a stale identity", () => {
    expect(astroDesignHint("temporarily-unconfirmable", "parser-busy").action).toBe(
      "retry",
    );
    expect(
      astroDesignHint("temporarily-unconfirmable", "preview-identity-mismatch").action,
    ).toBe("reload-preview");
  });

  it("never calls a capability limit an error, and says syntax errors are the file's", () => {
    expect(astroDesignHint("capability-limit", "source-too-large").message).not.toMatch(
      /error/i,
    );
    expect(astroDesignHint("author-syntax", "author-syntax").message).toMatch(
      /syntax error/i,
    );
  });

  it("uses the code-controlled wording only for class D", () => {
    expect(astroDesignHint("controlled-by-code", "analysis-diagnostics").message).toMatch(
      /controlled by code/i,
    );
    for (const klass of [
      "temporarily-unconfirmable",
      "capability-limit",
      "author-syntax",
    ] as const) {
      expect(astroDesignHint(klass, "x").message).not.toMatch(/controlled by code/i);
    }
  });
});

describe("astroWriteIdentity", () => {
  it("is the confirmed identity and Core's component digest, and nothing for Start", () => {
    const selection = resolve();
    expect(astroWriteIdentity(selection)).toEqual({
      identity: MARKER,
      componentDigest: COMPONENT_DIGEST,
    });
    expect(astroWriteIdentity(null)).toEqual({});
    expect(astroWriteIdentity({ status: "checking" })).toEqual({});
  });
});
