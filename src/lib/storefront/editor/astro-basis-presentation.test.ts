import { describe, expect, it } from "vitest";
import {
  acceptAstroBasisAck,
  astroBasisConfirmKey,
  astroBasisInstanceToConfirm,
  astroContentBasisEvents,
  astroBasisTokenFor,
  isAstroBasisFrame,
  noteAstroContentBasis,
  type AstroContentBasis,
} from "./astro-basis-presentation";
import type { SectionPresentationToken } from "./preview-protocol";

/**
 * The editor's half of the Astro basis ack (option B). The editor issues a
 * basis token only for a frame that advertises the basis capability and is
 * refreshed by reload, whose stamp names the ticket and instance Core itself
 * confirmed; the token's documentBasis is Core's draft generation for the
 * template in that snapshot, never the editor's own copy. It accepts an ack
 * only when the pair still matches. The stamp narrows; it grants nothing.
 */

const INSTANCE = "0b1f5a52-3c1e-4f43-9d0e-6c0f2f1f9a11";
const OTHER_INSTANCE = "11111111-2222-3333-4444-555555555555";
const IDENTITY = `0123456789abcdef:2:${"a".repeat(64)}:10:42`;
const BASIS_CAPABILITIES = new Set([
  "section-presentation-ack-v1",
  "astro-identity-v2",
  "astro-basis-ack-v1",
]);
const confirmed: AstroContentBasis = {
  ticket: 7,
  instance: INSTANCE,
  draftGenerations: { "template-1": 3 },
};
const request = {
  capabilities: BASIS_CAPABILITIES,
  contentRefresh: "reload" as const,
  servedContent: { ticket: 7, instance: INSTANCE },
  basis: confirmed,
  workspaceKey: "storefront-1:theme-1",
  templateId: "template-1",
  routePath: "/",
  sectionId: "hero",
  identity: IDENTITY,
  presentationRevision: 6,
};

describe("isAstroBasisFrame", () => {
  it("needs the three capabilities and a reload refresh", () => {
    expect(isAstroBasisFrame(BASIS_CAPABILITIES, "reload")).toBe(true);
    expect(isAstroBasisFrame(BASIS_CAPABILITIES, "invalidate")).toBe(false);
    expect(isAstroBasisFrame(BASIS_CAPABILITIES, null)).toBe(false);
    for (const missing of BASIS_CAPABILITIES) {
      const fewer = new Set(BASIS_CAPABILITIES);
      fewer.delete(missing);
      expect(isAstroBasisFrame(fewer, "reload"), missing).toBe(false);
    }
    // A Start frame: acknowledges overlays, nothing else.
    expect(
      isAstroBasisFrame(new Set(["section-presentation-ack-v1"]), null),
    ).toBe(false);
  });
});

describe("noteAstroContentBasis", () => {
  it("records what Core wrote, then the instance that confirmed it", () => {
    const written = noteAstroContentBasis(null, {
      kind: "written",
      ticket: 7,
      draftGenerations: { "template-1": 3 },
    });
    expect(written).toEqual({
      ticket: 7,
      instance: null,
      draftGenerations: { "template-1": 3 },
    });
    expect(
      noteAstroContentBasis(written, {
        kind: "confirmed",
        ticket: 7,
        instance: INSTANCE,
      }),
    ).toEqual(confirmed);
  });

  it("never goes back to an older ticket, and ignores a confirmation of another one", () => {
    expect(
      noteAstroContentBasis(confirmed, {
        kind: "written",
        ticket: 6,
        draftGenerations: { "template-1": 2 },
      }),
    ).toBe(confirmed);
    expect(
      noteAstroContentBasis(confirmed, {
        kind: "confirmed",
        ticket: 6,
        instance: OTHER_INSTANCE,
      }),
    ).toBe(confirmed);
    expect(
      noteAstroContentBasis(null, {
        kind: "confirmed",
        ticket: 7,
        instance: INSTANCE,
      }),
    ).toBe(null);
  });

  it("forgets the instance when a newer ticket is written", () => {
    expect(
      noteAstroContentBasis(confirmed, {
        kind: "written",
        ticket: 8,
        draftGenerations: { "template-1": 4 },
      }),
    ).toEqual({
      ticket: 8,
      instance: null,
      draftGenerations: { "template-1": 4 },
    });
  });

  it("keeps the instance for the same ticket written again", () => {
    expect(
      noteAstroContentBasis(confirmed, {
        kind: "written",
        ticket: 7,
        draftGenerations: { "template-1": 3 },
      }),
    ).toEqual(confirmed);
  });
});

describe("astroContentBasisEvents", () => {
  const generations = { "template-1": 3 };

  it("reads what a start, a sync and a confirm said", () => {
    expect(
      astroContentBasisEvents("start", {
        success: true,
        data: { contentTicket: 7, draftGenerations: generations },
      }),
    ).toEqual([{ kind: "written", ticket: 7, draftGenerations: generations }]);
    expect(
      astroContentBasisEvents("sync", {
        success: true,
        data: {
          ticket: 8,
          sentTicket: 7,
          draftGenerations: generations,
          instance: INSTANCE,
        },
      }),
    ).toEqual([
      { kind: "written", ticket: 7, draftGenerations: generations },
      { kind: "confirmed", ticket: 7, instance: INSTANCE },
    ]);
    expect(
      astroContentBasisEvents("sync", {
        success: false,
        error: "PREVIEW_CONTENT_NOT_CONFIRMED",
        ticket: 6,
        sentTicket: 7,
        draftGenerations: generations,
      }),
    ).toEqual([{ kind: "written", ticket: 7, draftGenerations: generations }]);
    expect(
      astroContentBasisEvents(
        "confirm",
        { success: true, data: { ticket: 7, instance: INSTANCE } },
        7,
      ),
    ).toEqual([{ kind: "confirmed", ticket: 7, instance: INSTANCE }]);
  });

  it("reads nothing from a Start answer, an older Core, or a refusal", () => {
    expect(
      astroContentBasisEvents("start", {
        success: true,
        data: { contentRefresh: "router" },
      }),
    ).toEqual([]);
    expect(
      astroContentBasisEvents("sync", { success: true, data: { ticket: 7 } }),
    ).toEqual([]);
    expect(
      astroContentBasisEvents(
        "confirm",
        { success: false, error: "PREVIEW_CONTENT_NOT_CONFIRMED", ticket: 0 },
        7,
      ),
    ).toEqual([]);
    expect(
      astroContentBasisEvents(
        "confirm",
        { success: true, data: { ticket: 7, instance: "bad\"x" } },
        7,
      ),
    ).toEqual([]);
    expect(astroContentBasisEvents("sync", null)).toEqual([]);
  });
});

describe("astroBasisInstanceToConfirm", () => {
  const none: ReadonlySet<string> = new Set();

  it("asks Core about the stamped ticket only when it is Core's latest and its instance is unknown", () => {
    const written = { ...confirmed, instance: null };
    expect(
      astroBasisInstanceToConfirm(
        { ticket: 7, instance: INSTANCE },
        written,
        none,
      ),
    ).toBe(7);
    expect(
      astroBasisInstanceToConfirm(
        { ticket: 7, instance: INSTANCE },
        confirmed,
        none,
      ),
    ).toBe(null);
    expect(
      astroBasisInstanceToConfirm(
        { ticket: 6, instance: INSTANCE },
        written,
        none,
      ),
    ).toBe(null);
    expect(astroBasisInstanceToConfirm(null, written, none)).toBe(null);
    expect(
      astroBasisInstanceToConfirm({ ticket: 7, instance: INSTANCE }, null, none),
    ).toBe(null);
  });

  // Review finding 2: the dev server restarted and stamped a new instance
  // into the same snapshot; the page reloaded names it with the same ticket.
  it("asks again when the page names Core's ticket from another instance than recorded", () => {
    expect(
      astroBasisInstanceToConfirm(
        { ticket: 7, instance: OTHER_INSTANCE },
        confirmed,
        none,
      ),
    ).toBe(7);
  });

  it("asks once per ticket and page instance, never again for the same pair", () => {
    const stamp = { ticket: 7, instance: OTHER_INSTANCE };
    const asked = new Set([astroBasisConfirmKey(stamp)]);
    expect(astroBasisInstanceToConfirm(stamp, confirmed, asked)).toBe(null);
    // Also after a start, whose answer named no instance: asked once, then
    // left to the next sync rather than asked on every ready.
    expect(
      astroBasisInstanceToConfirm(
        stamp,
        { ...confirmed, instance: null },
        asked,
      ),
    ).toBe(null);
    // Another page instance, or another ticket, is another pair.
    expect(
      astroBasisInstanceToConfirm(
        { ticket: 7, instance: "22222222-3333-4444-5555-666666666666" },
        confirmed,
        asked,
      ),
    ).toBe(7);
    expect(astroBasisConfirmKey(stamp)).not.toBe(
      astroBasisConfirmKey({ ticket: 8, instance: OTHER_INSTANCE }),
    );
  });

  it("lets Core's answer to the re-ask replace the instance for that ticket", () => {
    expect(
      noteAstroContentBasis(confirmed, {
        kind: "confirmed",
        ticket: 7,
        instance: OTHER_INSTANCE,
      }),
    ).toEqual({ ...confirmed, instance: OTHER_INSTANCE });
  });
});

describe("astroBasisTokenFor", () => {
  it("issues a basis token at Core's generation for the confirmed snapshot", () => {
    expect(astroBasisTokenFor(request)).toEqual({
      status: "token",
      token: {
        workspaceKey: "storefront-1:theme-1",
        templateId: "template-1",
        routePath: "/",
        sectionId: "hero",
        documentBasis: { kind: "existing", draftGeneration: 3 },
        overlayRevision: 0,
        presentationRevision: 6,
        operationId: "section-basis-6",
        basis: {
          kind: "astro-boundary",
          identity: IDENTITY,
          servedContent: { ticket: 7, instance: INSTANCE },
        },
      },
    });
  });

  it("refuses, with a reason, everything that is not that", () => {
    const cases: Array<[string, Partial<typeof request>]> = [
      ["not-basis-frame", { contentRefresh: null as never }],
      [
        "not-basis-frame",
        { capabilities: new Set(["section-presentation-ack-v1"]) },
      ],
      ["no-served-content", { servedContent: null as never }],
      ["no-confirmed-content", { basis: null as never }],
      ["other-ticket", { servedContent: { ticket: 6, instance: INSTANCE } }],
      ["unconfirmed-instance", { basis: { ...confirmed, instance: null } }],
      [
        "other-instance",
        { servedContent: { ticket: 7, instance: OTHER_INSTANCE } },
      ],
      ["no-core-generation", { templateId: "template-2" }],
      [
        "no-core-generation",
        { basis: { ...confirmed, draftGenerations: { "template-1": 0 } } },
      ],
    ];
    for (const [reason, change] of cases) {
      expect(astroBasisTokenFor({ ...request, ...change }), reason).toEqual({
        status: "refused",
        reason,
      });
    }
  });
});

describe("acceptAstroBasisAck", () => {
  const issued = astroBasisTokenFor(request);
  if (issued.status !== "token") throw new Error("fixture");
  const token = issued.token;

  it("accepts the ack while the frame's stamp and Core's confirmation still match the token", () => {
    expect(
      acceptAstroBasisAck({
        token,
        servedContent: { ticket: 7, instance: INSTANCE },
        basis: confirmed,
      }),
    ).toEqual({ accept: true });
  });

  it("holds it when anything moved since the token was issued", () => {
    const cases: Array<
      [string, Partial<Parameters<typeof acceptAstroBasisAck>[0]>]
    > = [
      ["no-served-content", { servedContent: null }],
      ["other-snapshot", { servedContent: { ticket: 8, instance: INSTANCE } }],
      ["no-confirmed-content", { basis: null }],
      // Core wrote a newer snapshot since: this document is older than it.
      [
        "other-ticket",
        {
          basis: {
            ticket: 8,
            instance: null,
            draftGenerations: { "template-1": 4 },
          },
        },
      ],
      ["unconfirmed-instance", { basis: { ...confirmed, instance: null } }],
      ["other-instance", { basis: { ...confirmed, instance: OTHER_INSTANCE } }],
      [
        "no-core-generation",
        { basis: { ...confirmed, draftGenerations: { "template-1": 4 } } },
      ],
    ];
    for (const [reason, change] of cases) {
      expect(
        acceptAstroBasisAck({
          token,
          servedContent: { ticket: 7, instance: INSTANCE },
          basis: confirmed,
          ...change,
        }),
        reason,
      ).toEqual({ accept: false, reason });
    }
  });

  it("is not asked about a Start token", () => {
    const start: SectionPresentationToken = {
      ...token,
      overlayRevision: 2,
      operationId: "section-presentation-6",
      basis: undefined,
    };
    delete (start as { basis?: unknown }).basis;
    expect(
      acceptAstroBasisAck({
        token: start,
        servedContent: { ticket: 7, instance: INSTANCE },
        basis: confirmed,
      }),
    ).toEqual({ accept: false, reason: "not-a-basis-token" });
  });
});
