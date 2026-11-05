import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { StorefrontThemeFileDTO } from "@/lib/storefront/dto/storefront-theme-file.dto";
import type { EditorSelectionDescriptor } from "@/lib/storefront/editor/selection-taxonomy";
import { astroPreviewSourceHash } from "@/lib/storefront/theme-framework/astro-preview-locate";
import { resolveSourceLocatedTarget } from "@/routes/_editor/-components/editor-code-selection";
import { astroDesignSelectionRequest } from "./astro-design-selection";
import { previewSourceIdentityReport } from "./preview-dom";
import {
  EDITOR_CAPABILITIES,
  PREVIEW_CAPABILITIES,
  parsePreviewToEditorMessage,
  type PreviewCapability,
  type PreviewSelectionMessage,
} from "./preview-protocol";

// M2 PR-I, P3: the mixed-version matrix of design v2 §7. In every cell the
// click keeps locating (L1.5a) and none yields a Design selection that Core
// has not confirmed. The capability selects the format only; Core's
// verification (astro-instance-identity.test.ts) runs whatever was announced.

const NONCE = "0123456789abcdef";
const COMPONENT = "src/components/Hero.astro";
const COMPONENT_SOURCE =
  "---\nconst { title } = Astro.props;\n---\n<section><h1>{title}</h1></section>\n";
const DIGEST = "d".repeat(64);
const V2_ID = `${NONCE}:2:${"a".repeat(64)}:120:158`;
const V1_ID = `${NONCE}:0badf00d:0`;

/** main's bounds for these fields, fixed here on purpose (not the new ones). */
const MAIN_MARKER_LIMIT = 40;
const MAIN_SOURCE_VERSION_LIMIT = 16;

/**
 * Whether main's editor (before PR-I) accepts the identity fields of a
 * selection message: a marker over 40 or a version over 16 characters failed
 * the whole message. Unknown keys (`sourceDigest`) it dropped.
 */
function mainEditorAccepts(message: Record<string, unknown>): boolean {
  const boundary = message.previewBoundary as
    { marker?: unknown } | null | undefined;
  const marker = boundary?.marker ?? null;
  const version = message.sourceVersion ?? null;
  return (
    (marker === null ||
      (typeof marker === "string" && marker.length <= MAIN_MARKER_LIMIT)) &&
    (version === null ||
      (typeof version === "string" &&
        version.length <= MAIN_SOURCE_VERSION_LIMIT))
  );
}

/** A selection message as the bridge builds it, around the identity part. */
function selectionMessage(
  identity: Record<string, unknown>,
  element = target(),
): Record<string, unknown> {
  return {
    type: "morph:storefront-preview-select-section",
    sectionId: `source:${COMPONENT}`,
    componentType: "custom",
    kind: "section",
    sourceFilePath: COMPONENT,
    sourceLocation: element.dataset.morphLoc ?? null,
    sourceVersion: element.dataset.morphLocV ?? null,
    locatedAt: null,
    ...identity,
    elementKey: null,
    fieldKey: null,
    field: null,
    fieldPath: null,
    descendantFields: [],
    tagName: "section",
    role: null,
    inputType: null,
    styleRevision: 0,
    className: "",
    isSection: true,
    inspectorOverride: null,
    computedStyle: null,
    parentComputedStyle: null,
    sectionComputedStyle: null,
  };
}

const target = () => document.querySelector<HTMLElement>("#target")!;

/** The page a v2 plugin serves: v2 markers, all three location attributes. */
function servePage(markers: "v2" | "v1", digest: string | null = DIGEST) {
  const id = markers === "v2" ? V2_ID : V1_ID;
  const tag = markers === "v2" ? "morph:s2" : "morph:s";
  document.body.innerHTML =
    `<!--${tag} ${id}--><section id="target" data-morph-loc="${COMPONENT}:4:1"` +
    ` data-morph-loc-v="${astroPreviewSourceHash(COMPONENT_SOURCE)}"` +
    (digest === null ? "" : ` data-morph-loc-s="${digest}"`) +
    `><h1>t</h1></section><!--/${tag} ${id}-->`;
}

/** L1.5a: the Code jump the editor makes from a located click. */
function locates(message: PreviewSelectionMessage | null) {
  expect(message).not.toBeNull();
  return resolveSourceLocatedTarget({
    selection: {
      sectionId: message!.sectionId,
      sourceLocation: message!.sourceLocation ?? null,
      sourceVersion: message!.sourceVersion ?? null,
      tagName: message!.tagName,
    } as EditorSelectionDescriptor,
    themeFiles: [
      { path: COMPONENT, content: COMPONENT_SOURCE } as StorefrontThemeFileDTO,
    ],
  });
}

const OLD_FRAME: ReadonlySet<PreviewCapability> = new Set([
  "selection-field-section",
  "code-default-selection",
]);
const NEW_FRAME: ReadonlySet<PreviewCapability> = new Set([
  ...OLD_FRAME,
  "astro-identity-v2",
]);

beforeEach(() => {
  (globalThis as Record<string, unknown>).__morphPreviewSourceSelection = {
    nonce: NONCE,
  };
});
afterEach(() => {
  delete (globalThis as Record<string, unknown>).__morphPreviewSourceSelection;
  document.body.replaceChildren();
});

describe("one token, in both lists", () => {
  it("is astro-identity-v2, a preview and an editor capability", () => {
    expect(PREVIEW_CAPABILITIES).toContain("astro-identity-v2");
    expect(EDITOR_CAPABILITIES).toContain("astro-identity-v2");
  });
});

describe("new bridge × old editor (no astro-identity-v2 announced)", () => {
  it("sends no identity, the same L1.5a fields, and stays inside main's limits", () => {
    servePage("v2");
    const identity = previewSourceIdentityReport(target(), false);
    expect(identity).toEqual({
      previewBoundary: { marker: null, selectable: true, reason: null },
    });
    expect(identity).not.toHaveProperty("sourceDigest");
    const message = selectionMessage(identity);
    expect(message.sourceLocation).toBe(`${COMPONENT}:4:1`);
    expect(message.sourceVersion).toBe(
      astroPreviewSourceHash(COMPONENT_SOURCE),
    );
    expect(mainEditorAccepts(message)).toBe(true);
    // And it still locates.
    expect(
      locates(parsePreviewToEditorMessage(message) as PreviewSelectionMessage),
    ).toEqual({
      filePath: COMPONENT,
      line: 4,
      column: 1,
    });
  });

  it("would have failed main's editor whole if the bridge sent v2 unasked", () => {
    servePage("v2");
    const unasked = selectionMessage(
      previewSourceIdentityReport(target(), true),
    );
    expect(mainEditorAccepts(unasked)).toBe(false);
  });
});

describe("new bridge × new editor", () => {
  it("sends the v2 id and the clicked file's sha256, and locates as before", () => {
    servePage("v2");
    const identity = previewSourceIdentityReport(target(), true);
    expect(identity).toEqual({
      previewBoundary: { marker: V2_ID, selectable: true, reason: null },
      sourceDigest: DIGEST,
    });
    const parsed = parsePreviewToEditorMessage(
      selectionMessage(identity),
    ) as PreviewSelectionMessage;
    expect(parsed).toMatchObject({
      previewBoundary: { marker: V2_ID },
      sourceDigest: DIGEST,
    });
    expect(locates(parsed)).toEqual({
      filePath: COMPONENT,
      line: 4,
      column: 1,
    });
    // A request for Core to verify, not a selection.
    expect(astroDesignSelectionRequest(parsed, NEW_FRAME)).toEqual({
      status: "pending-core",
      marker: V2_ID,
      sourceLocation: `${COMPONENT}:4:1`,
      sourceDigest: DIGEST,
    });
  });

  it("bounds the marker at 128 and takes a digest of exactly 64 lowercase hex", () => {
    servePage("v2");
    const base = selectionMessage(previewSourceIdentityReport(target(), true));
    const withMarker = (marker: string) => ({
      ...base,
      previewBoundary: { marker, selectable: true, reason: null },
    });
    expect(
      parsePreviewToEditorMessage(withMarker("x".repeat(128))),
    ).not.toBeNull();
    expect(parsePreviewToEditorMessage(withMarker("x".repeat(129)))).toBeNull();
    for (const sourceDigest of [
      "d".repeat(63),
      "d".repeat(65),
      "D".repeat(64),
      "0badf00d",
      12,
    ]) {
      expect(parsePreviewToEditorMessage({ ...base, sourceDigest })).toBeNull();
    }
    expect(
      parsePreviewToEditorMessage({ ...base, sourceDigest: null }),
    ).not.toHaveProperty("sourceDigest");
  });

  it("offers nothing to confirm without a digest, outside a boundary, or on a refused range", () => {
    servePage("v2", null);
    const noDigest = parsePreviewToEditorMessage(
      selectionMessage(previewSourceIdentityReport(target(), true)),
    ) as PreviewSelectionMessage;
    expect(noDigest).not.toHaveProperty("sourceDigest");
    expect(astroDesignSelectionRequest(noDigest, NEW_FRAME)).toEqual({
      status: "unavailable",
      reason: "no-source-digest",
    });
    // A forged digest attribute is not forwarded at all.
    servePage("v2", "forged");
    expect(previewSourceIdentityReport(target(), true)).not.toHaveProperty(
      "sourceDigest",
    );
    document.body.innerHTML = `<section id="target" data-morph-loc="${COMPONENT}:4:1"></section>`;
    expect(
      astroDesignSelectionRequest(
        parsePreviewToEditorMessage(
          selectionMessage(previewSourceIdentityReport(target(), true)),
        ) as PreviewSelectionMessage,
        NEW_FRAME,
      ),
    ).toEqual({ status: "unavailable", reason: "outside" });
  });
});

describe("old bridge × new editor (a preview from before PR-I)", () => {
  /** What main's bridge sent: its v1 id, its own limits, no digest. */
  const oldBridgeMessage = () => {
    servePage("v1", null);
    return selectionMessage({
      previewBoundary: { marker: V1_ID, selectable: true, reason: null },
    });
  };

  it("still locates, and asks for a reload instead of a Design selection", () => {
    const parsed = parsePreviewToEditorMessage(
      oldBridgeMessage(),
    ) as PreviewSelectionMessage;
    expect(locates(parsed)).toEqual({
      filePath: COMPONENT,
      line: 4,
      column: 1,
    });
    expect(astroDesignSelectionRequest(parsed, OLD_FRAME)).toEqual({
      status: "needs-reload",
    });
  });

  it("never turns an old marker into an identity, whatever the frame announced", () => {
    const parsed = parsePreviewToEditorMessage(
      oldBridgeMessage(),
    ) as PreviewSelectionMessage;
    expect(astroDesignSelectionRequest(parsed, NEW_FRAME)).toEqual({
      status: "unavailable",
      reason: "no-identity",
    });
  });

  it("a new bridge reads old markers as no boundary at all", () => {
    servePage("v1");
    expect(previewSourceIdentityReport(target(), true)).toEqual({
      previewBoundary: { marker: null, selectable: false, reason: "outside" },
      sourceDigest: DIGEST,
    });
  });
});

describe("Start pages", () => {
  it("report no boundary and no digest, as before", () => {
    servePage("v2");
    delete (globalThis as Record<string, unknown>)
      .__morphPreviewSourceSelection;
    expect(previewSourceIdentityReport(target(), true)).toEqual({
      previewBoundary: null,
    });
    expect(previewSourceIdentityReport(target(), false)).toEqual({
      previewBoundary: null,
    });
  });
});
