import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { parsePreviewToEditorEnvelope } from "./preview-protocol";

/**
 * What the CURRENT editor's parser does with the messages a real OLDER Live
 * Preview bridge posts.
 *
 * The bridges are frozen under `e2e/fixtures/old-bridges/<label>/` as the exact
 * bytes a Theme workspace received at a past commit (see each manifest.json).
 * Nothing is executed: the message types and field names are read from the
 * frozen entry script, and the values are representative. That is enough to
 * answer "does today's parser accept, refuse or ignore this shape"; it does
 * not prove the old page behaves in a browser (that is the E2E part).
 *
 * A message the old bridge builds from computed values (the sibling, section
 * and array-item reorder commits, built in `preview-reorder-identity`) is not
 * replayed.
 */
const FIXTURES = join(process.cwd(), "e2e/fixtures/old-bridges");
const SESSION = "0f5c8a52-7c3a-4d1e-9b1a-2f7d6b3c4e5f";
const ORIGIN = "http://localhost:3000";
const ENTRY = "src/morph/preview-bridge.ts";
const PROTOCOL = "src/morph/preview/preview-protocol.ts";

type Manifest = {
  label: string;
  sourceCommit: string;
  sha256: string;
  files: { path: string; storedAs: string }[];
};

function load(label: string) {
  const dir = join(FIXTURES, label);
  const manifest = JSON.parse(
    readFileSync(join(dir, "manifest.json"), "utf8"),
  ) as Manifest;
  const files = new Map(
    manifest.files.map((file) => [
      file.path,
      readFileSync(join(dir, file.storedAs), "utf8"),
    ]),
  );
  return { manifest, files };
}

/** The text of one posted literal: from its `type:` line to the next `channel`. */
function postedBlock(entry: string, type: string): string {
  const start = entry.indexOf(`type: "${type}"`);
  expect(start, `${type} is posted by the entry`).toBeGreaterThan(-1);
  const end = entry.indexOf("channel", start);
  return entry.slice(start, end === -1 ? start + 4000 : end);
}

type Replay = {
  type: string;
  payload: Record<string, unknown>;
  /** Fields the message gets from a spread, so they are not in the literal. */
  fromSpread?: boolean;
  /** Keys the literal gets from `...selectionMetadata(item)`; found in the bundle. */
  metadataKeys?: string[];
};

const REPLAYS: Replay[] = [
  { type: "morph:storefront-preview-ready", payload: {} },
  { type: "morph:storefront-preview-pong", payload: { heartbeatId: 5 } },
  {
    type: "morph:storefront-preview-history-shortcut",
    payload: { direction: "undo" },
  },
  {
    type: "morph:storefront-preview-route-applied",
    payload: { routeRequestId: 3, routePath: "/" },
  },
  {
    type: "morph:storefront-preview-theme-files-applied",
    payload: { styleRevision: 2 },
  },
  {
    type: "morph:storefront-preview-theme-files-failed",
    payload: { styleRevision: 2 },
  },
  { type: "morph:storefront-preview-structure", payload: { nodes: [] } },
  {
    type: "morph:storefront-preview-inline-text-editing",
    payload: { editing: true },
  },
  {
    type: "morph:storefront-preview-inline-text-refused",
    payload: { sectionId: "hero", fieldPath: "title" },
  },
  {
    type: "morph:storefront-preview-commit-inline-text",
    fromSpread: true,
    payload: {
      sectionId: "hero",
      fieldKey: "title",
      fieldPath: "title",
      value: "New",
      originalValue: "Old",
    },
  },
  {
    type: "morph:storefront-preview-wheel",
    fromSpread: true,
    payload: {
      deltaY: 10,
      deltaMode: 0,
      ctrlKey: false,
      clientX: 1,
      clientY: 2,
    },
  },
  {
    type: "morph:storefront-preview-select-section",
    metadataKeys: [
      "sourceFilePath",
      "tagName",
      "role",
      "inputType",
      "fieldPath",
    ],
    payload: {
      sectionId: "hero",
      componentType: "Hero",
      kind: "section",
      sourceLocation: null,
      elementKey: null,
      fieldKey: null,
      field: null,
      descendantFields: [],
      itemId: null,
      contentUnavailable: null,
      // From `selectionMetadata(item)` in the frozen preview-dom module.
      sourceFilePath: null,
      tagName: "section",
      role: null,
      inputType: null,
      fieldPath: null,
      styleRevision: 0,
      selectionRevision: 1,
      className: "",
      isSection: true,
      inspectorOverride: null,
      computedStyle: null,
      parentComputedStyle: null,
      sectionComputedStyle: null,
      documentRect: { top: 0, height: 10 },
    },
  },
];

const VARIANTS = [
  {
    label: "without-document-id",
    capabilities: ["selection-field-section"] as string[] | undefined,
  },
  { label: "without-capabilities", capabilities: undefined },
];

function replay(
  data: Record<string, unknown>,
  previewSession = SESSION,
): ReturnType<typeof parsePreviewToEditorEnvelope> {
  const source = {} as Window;
  return parsePreviewToEditorEnvelope(
    {
      data: { ...data, previewSession },
      origin: ORIGIN,
      source,
    } as unknown as MessageEvent<unknown>,
    { expectedOrigin: ORIGIN, expectedSource: source, previewSession: SESSION },
  );
}

describe.each(VARIANTS)(
  "the current editor reading the $label bridge",
  ({ label, capabilities }) => {
    const { manifest, files } = load(label);
    const entry = files.get(ENTRY) ?? "";
    const bundle = [...files.values()].join("\n");

    it("is the frozen bytes its manifest names", () => {
      const sorted = [...files.entries()].sort(([a], [b]) =>
        a < b ? -1 : a > b ? 1 : 0,
      );
      expect(
        createHash("sha256").update(JSON.stringify(sorted)).digest("hex"),
      ).toBe(manifest.sha256);
    });

    it("posts with the older envelope: the session, and no document id", () => {
      const protocol = files.get(PROTOCOL) ?? "";
      const post = protocol.slice(
        protocol.indexOf("export function postPreviewToEditorMessage"),
      );
      expect(post).toContain("previewSession: channel.previewSession");
      expect(protocol).not.toContain("previewDocument");
    });

    it("posts the types this replay covers, and no others of its own", () => {
      const literal = new Set(
        [...entry.matchAll(/type: "(morph:storefront-preview-[a-z-]+)"/g)]
          .map((match) => match[1])
          .filter(
            // Types the entry only compares against (editor to page).
            (type) =>
              !/-(request-|update-|set-|refresh-|finish-|ping)/.test(type),
          ),
      );
      expect([...literal].sort()).toEqual(REPLAYS.map((r) => r.type).sort());
    });

    it("announces ready with the capabilities of its commit, nothing more", () => {
      const block = postedBlock(entry, "morph:storefront-preview-ready");
      expect(block.includes("capabilities")).toBe(capabilities !== undefined);
    });

    describe.each(REPLAYS)(
      "$type",
      ({ type, payload, fromSpread, metadataKeys = [] }) => {
        it("names only fields the frozen source builds", () => {
          const haystack = fromSpread ? bundle : postedBlock(entry, type);
          for (const key of Object.keys(payload)) {
            const where = metadataKeys.includes(key) ? bundle : haystack;
            expect(where, `${key} appears in the frozen source`).toContain(key);
          }
        });

        it("is accepted and read without a document id", () => {
          const envelope = replay({ type, ...payload });
          expect(envelope).not.toBeNull();
          expect(envelope?.message.type).toBe(type);
          // An older bridge names no document: unverified, not malformed.
          expect(envelope?.previewDocument).toBeNull();
          expect(envelope?.malformedDocument).toBe(false);
        });
      },
    );

    it("reads ready's capabilities exactly as that bridge announced them", () => {
      const ready = {
        type: "morph:storefront-preview-ready",
        ...(capabilities ? { capabilities } : {}),
      };
      const message = replay(ready)?.message;
      expect(message).toEqual({
        type: "morph:storefront-preview-ready",
        ...(capabilities ? { capabilities } : {}),
      });
    });

    it("refuses the same messages under another session without throwing", () => {
      for (const { type, payload } of REPLAYS) {
        expect(
          replay({ type, ...payload }, "1f5c8a52-7c3a-4d1e-9b1a-2f7d6b3c4e5f"),
        ).toBeNull();
      }
    });
  },
);
