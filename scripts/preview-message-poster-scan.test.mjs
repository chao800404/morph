/**
 * The shapes the poster rule has to tell apart (G1).
 *
 * Run by `node --test` from `check:preview-message-posters`. Not vitest: its
 * include pattern is `src/**\/*.test.{ts,tsx}`, so a test beside a script would
 * never be collected.
 *
 * Every fixture is a string literal, so this file holds no message of its
 * own: the parser sees one string per fixture, never the guarded type.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  applyAllowList,
  GUARDED_MESSAGES,
  scanSource,
} from "./preview-message-poster-scan.mjs";

const SHELL = "src/routes/_editor/-components/visual-editor-shell.tsx";
const SECTION = "morph:storefront-preview-update-section-props";
const FIELD = "morph:storefront-preview-update-selection-field";

const OWNERS = `
const postPreviewSectionProps = useCallback((sectionId, props, enabled) => {
  postEditorToPreviewMessage(frame(), {
    type: "${SECTION}",
    sectionId,
    props,
    enabled,
  });
}, []);
const previewSelectionField = useCallback((sectionId, fieldKey, fieldPath, value) => {
  postEditorToPreviewMessage(frame(), {
    type: "${FIELD}",
    sectionId,
    fieldKey,
    fieldPath,
    value,
  });
}, [leaveGuard]);
`;

/** The selection-field owner, building its message with `fields` in place of its own. */
const fieldOwnerWith = (fields) => `
const previewSelectionField = useCallback((sectionId, fieldKey, fieldPath, value) => {
  postEditorToPreviewMessage(frame(), {
    type: "${FIELD}",
    ${fields}
  });
}, [leaveGuard]);
`;

describe("the owners", () => {
  it("pass in the shell", () => {
    assert.deepEqual(scanSource(OWNERS, SHELL), []);
  });

  it("are named for both messages", () => {
    assert.deepEqual(Object.keys(GUARDED_MESSAGES).sort(), [FIELD, SECTION].sort());
  });

  it("fail anywhere but the shell", () => {
    assert.equal(scanSource(OWNERS, "src/elsewhere.tsx").length, 2);
  });
});

describe("a field the message must name", () => {
  const missing = (fields) =>
    scanSource(fieldOwnerWith(fields), SHELL).map(({ message, kind, owner, field }) => ({
      message,
      kind,
      owner,
      field,
    }));
  const finding = {
    message: FIELD,
    kind: "missing-field",
    owner: "previewSelectionField",
    field: "sectionId",
  };

  it("the selection-field owner fails without a sectionId of its own", () => {
    assert.deepEqual(missing("fieldKey, fieldPath, value,"), [finding]);
  });

  it("a sectionId carried in by spread is not one of its own", () => {
    assert.deepEqual(missing("...target, fieldKey, fieldPath, value,"), [finding]);
  });

  it("a written-out sectionId passes, shorthand or not", () => {
    assert.deepEqual(missing("sectionId: activeSectionId, fieldKey, fieldPath, value,"), []);
    assert.deepEqual(missing("sectionId, fieldKey, fieldPath, value,"), []);
  });
});

describe("a second poster", () => {
  it("of the section message fails, beside the owner", () => {
    const findings = scanSource(
      `${OWNERS}
const replayHidden = useCallback((sectionId) => {
  postEditorToPreviewMessage(frame(), {
    type: "${SECTION}",
    sectionId,
    props: stored(sectionId),
  });
}, []);`,
      SHELL,
    );
    assert.deepEqual(
      findings.map(({ message, kind, owner }) => ({ message, kind, owner })),
      [{ message: SECTION, kind: "built", owner: "replayHidden" }],
    );
  });

  it("of the selection-field message fails", () => {
    const findings = scanSource(
      `${OWNERS}
function typeIntoCanvas(value) {
  postEditorToPreviewMessage(frame(), { type: "${FIELD}", fieldKey: "heading", fieldPath: null, value });
}`,
      SHELL,
    );
    assert.equal(findings.length, 1);
    assert.equal(findings[0].owner, "typeIntoCanvas");
  });

  it("nested inside the owner's own helper fails as that helper", () => {
    const findings = scanSource(
      `const postPreviewSectionProps = useCallback(() => {
  const later = () => post({ type: "${SECTION}", sectionId: "a" });
  later();
}, []);`,
      SHELL,
    );
    assert.equal(findings.length, 1);
    assert.equal(findings[0].owner, "later");
  });

  it("each owner may build only its own message", () => {
    const findings = scanSource(
      `const previewSelectionField = useCallback(() => {
  post({ type: "${SECTION}", sectionId: "a" });
}, []);`,
      SHELL,
    );
    assert.equal(findings.length, 1);
  });

  it("through a constant holding the type fails", () => {
    const findings = scanSource(
      `const SECTION_PROPS = "${SECTION}";
function elsewhere() { post({ type: SECTION_PROPS, sectionId: "a" }); }`,
      SHELL,
    );
    assert.deepEqual(
      findings.map(({ kind }) => kind),
      ["other"],
    );
  });

  it("in a template literal fails", () => {
    const findings = scanSource(
      "function elsewhere() { post({ type: `" + SECTION + "`, sectionId: 'a' }); }",
      SHELL,
    );
    assert.equal(findings.length, 1);
  });

  it("in a template literal with a substitution fails, as every type it could spell", () => {
    const prefix = SECTION.slice(0, SECTION.lastIndexOf("update-") + "update-".length);
    const findings = scanSource(
      `${OWNERS}
function elsewhere(kind) { post({ type: \`${prefix}\${kind}\`, sectionId: "a" }); }`,
      SHELL,
    );
    assert.deepEqual(
      findings
        .map(({ message, kind, owner }) => ({ message, kind, owner }))
        .sort((a, b) => a.message.localeCompare(b.message)),
      [
        { message: SECTION, kind: "built", owner: "elsewhere" },
        { message: FIELD, kind: "built", owner: "elsewhere" },
      ].sort((a, b) => a.message.localeCompare(b.message)),
    );
  });

  it("in a template literal whose substitution is the prefix fails", () => {
    const suffix = SECTION.slice(SECTION.lastIndexOf("update-"));
    const findings = scanSource(
      `function elsewhere(prefix) { post({ type: \`\${prefix}${suffix}\`, sectionId: "a" }); }`,
      "src/elsewhere.ts",
    );
    assert.deepEqual(
      findings.map(({ message, kind }) => ({ message, kind })),
      [{ message: SECTION, kind: "built" }],
    );
  });

  it("with a type no literal spells, posted, fails", () => {
    const findings = scanSource(
      "function elsewhere(NS, k) { postEditorToPreviewMessage(frame(), { type: `${NS}-${k}`, sectionId: 'a' }); }\n" +
        "function again(type) { window.postMessage({ type, sectionId: 'a' } as never, '*'); }",
      "src/elsewhere.ts",
    );
    assert.deepEqual(
      findings.map(({ kind, owner }) => ({ kind, owner })),
      [
        { kind: "unliteral-type", owner: "elsewhere" },
        { kind: "unliteral-type", owner: "again" },
      ],
    );
  });

  it("joined from a fragment in a template fails", () => {
    const suffix = SECTION.slice(SECTION.lastIndexOf("update-"));
    const findings = scanSource(
      `function elsewhere(P) { post({ type: \`\${P}\${"${suffix}"}\`, sectionId: "a" }); }`,
      "src/elsewhere.ts",
    );
    assert.deepEqual(
      findings.map(({ message, kind }) => ({ message, kind })),
      [{ message: SECTION, kind: "fragment" }],
    );
  });

  it("a template run that is a fragment fails, though the template cannot spell the type", () => {
    const findings = scanSource(
      "function elsewhere(q) { return P + `update-section-${q}!`.slice(0, -1); }",
      "src/elsewhere.ts",
    );
    assert.deepEqual(
      findings.map(({ message, kind, text }) => ({ message, kind, text })),
      [{ message: SECTION, kind: "fragment", text: "update-section-" }],
    );
  });

  it("joined from a fragment with + fails", () => {
    const suffix = SECTION.slice(SECTION.lastIndexOf("update-"));
    const findings = scanSource(
      `function elsewhere(P) { post({ type: P + "${suffix}", sectionId: "a" }); }`,
      "src/elsewhere.ts",
    );
    assert.deepEqual(
      findings.map(({ message, kind, owner }) => ({ message, kind, owner })),
      [{ message: SECTION, kind: "fragment", owner: "elsewhere" }],
    );
  });

  it("from a second function carrying the owner's name fails", () => {
    const findings = scanSource(
      `${OWNERS}
function replay(sectionId) {
  const postPreviewSectionProps = () =>
    post({ type: "${SECTION}", sectionId, props: stored(sectionId) });
  postPreviewSectionProps();
}`,
      SHELL,
    );
    assert.deepEqual(
      findings.map(({ message, kind, owner }) => ({ message, kind, owner })),
      [
        { message: SECTION, kind: "shadowed", owner: "postPreviewSectionProps" },
        { message: SECTION, kind: "shadowed", owner: "postPreviewSectionProps" },
      ],
    );
  });
});

describe("what is not a poster", () => {
  it("the protocol's declaration and parser, and a receiver's comparison", () => {
    const source = `
type EditorToPreview =
  | { type: "${SECTION}"; sectionId: string }
  | { type: "${FIELD}"; value: string };
function parse(data) {
  switch (data.type) {
    case "${SECTION}":
    case "${FIELD}":
      return data;
  }
}
function receive(message) {
  if (message?.type === "${SECTION}") apply(message);
  if (message.type !== "${FIELD}") return;
}`;
    assert.deepEqual(scanSource(source, "src/lib/storefront/editor/preview-protocol.ts"), []);
  });

  it("text that only mentions the type inside a longer string", () => {
    assert.deepEqual(
      scanSource(
        `const bridge = \`if (message?.type === "${SECTION}") update();\`;`,
        "src/lib/storefront/compiler/bridge.ts",
      ),
      [],
    );
  });

  it("a template with substitutions whose fixed text cannot spell a guarded type", () => {
    assert.deepEqual(
      scanSource(
        "const key = `${templateId}:${sectionId}`;\n" +
          "const other = `morph:storefront-preview-set-${kind}`;\n" +
          "const any = `${a}${b}`;",
        SHELL,
      ),
      [],
    );
  });

  it("a posted message whose type is a literal, and pieces inside an owner", () => {
    assert.deepEqual(
      scanSource(
        `function elsewhere() { postEditorToPreviewMessage(frame(), { type: "morph:storefront-preview-set-section-order" }); }
const postPreviewSectionProps = useCallback((kind) => {
  postEditorToPreviewMessage(frame(), { type: kind, note: "${SECTION.slice(-13)}" });
}, []);`,
        SHELL,
      ),
      [],
    );
  });

  it("a word the type contains, and a posted type chosen between literals", () => {
    assert.deepEqual(
      scanSource(
        `const kind = "storefront";
function ack(ok) {
  postPreviewToEditorMessage({ type: ok ? "morph:storefront-preview-theme-files-applied" : "morph:storefront-preview-theme-files-failed" });
}`,
        "src/elsewhere.ts",
      ),
      [],
    );
  });

  it("an object whose own type is something else", () => {
    assert.deepEqual(
      scanSource(
        `post({ type: "morph:storefront-preview-set-section-order", note: "${SECTION}" === kind });`,
        "src/elsewhere.ts",
      ),
      [],
    );
  });
});

describe("what is posted as a literal however it is wrapped", () => {
  it("as const, satisfies and ! around a literal or a choice between literals", () => {
    assert.deepEqual(
      scanSource(
        `function ack(ok) {
  postPreviewToEditorMessage({ type: (ok ? "morph:storefront-preview-theme-files-applied" : "morph:storefront-preview-theme-files-failed") as const });
  postPreviewToEditorMessage({ type: "morph:storefront-preview-pong" satisfies string });
  postPreviewToEditorMessage({ type: ("morph:storefront-preview-ping" as const)! });
}`,
        "src/elsewhere.ts",
      ),
      [],
    );
  });
});

describe("a template the scan cannot afford to backtrack on", () => {
  it("many empty runs before one that does not match finish at once", () => {
    const source =
      "const t = `" + "${a}".repeat(40) + SECTION + "X`;";
    const started = performance.now();
    const findings = scanSource(source, "src/elsewhere.ts");
    const elapsed = performance.now() - started;
    assert.deepEqual(findings, []);
    assert.ok(elapsed < 1000, `took ${elapsed.toFixed(0)} ms`);
  });
});

/**
 * The allow-list the command applies, run on fixtures: an entry excuses only
 * its own text in its own function, and only as many times as it expects.
 */
describe("the allow-list", () => {
  const PREVIEW = "src/routes/_editor/store/$storefrontId/themes/$themeId/preview.tsx";
  const RECEIVER = `
const handlePreviewSelection = (event) => {
  if (event.data.type.startsWith("morph:storefront-preview-")) warn(event.data.type);
};`;
  const scanned = (shell) => [
    ...scanSource(`const REMEASURE = new Set(["${SECTION}"]);`, PREVIEW).map(
      (finding) => ({ file: PREVIEW, ...finding }),
    ),
    ...scanSource(shell, SHELL).map((finding) => ({ file: SHELL, ...finding })),
  ];

  it("excuses the receiver's namespace test and the preview route's set, once each", () => {
    assert.deepEqual(applyAllowList(scanned(`${OWNERS}${RECEIVER}`)), {
      unexcused: [],
      miscounted: [],
    });
  });

  it("does not excuse the same text in a new poster in the shell (C25)", () => {
    const { unexcused } = applyAllowList(
      scanned(`${OWNERS}${RECEIVER}
const PREVIEW_NS = "morph:storefront-preview-";
const replayAll = useCallback((kind) => {
  const message = { type: PREVIEW_NS + kind, sectionId: "a" };
  postEditorToPreviewMessage(frame(), message);
}, []);`),
    );
    assert.deepEqual(
      unexcused.map(({ message, kind, owner, text }) => ({ message, kind, owner, text })),
      [
        { message: SECTION, kind: "fragment", owner: null, text: "morph:storefront-preview-" },
        { message: FIELD, kind: "fragment", owner: null, text: "morph:storefront-preview-" },
      ],
    );
  });

  it("fails an entry matched more often than it expects, even in its own function", () => {
    const { unexcused, miscounted } = applyAllowList(
      scanned(`${OWNERS}
const handlePreviewSelection = (event) => {
  if (event.data.type.startsWith("morph:storefront-preview-")) warn(event.data.type);
  const forged = "morph:storefront-preview-";
};`),
    );
    assert.deepEqual(unexcused, []);
    assert.deepEqual(
      miscounted.map(({ message, owner, count, found }) => ({ message, owner, count, found })),
      [
        { message: SECTION, owner: "handlePreviewSelection", count: 1, found: 2 },
        { message: FIELD, owner: "handlePreviewSelection", count: 1, found: 2 },
      ],
    );
  });

  it("fails an entry that matches nothing", () => {
    const { miscounted } = applyAllowList(scanned(OWNERS));
    assert.deepEqual(
      miscounted.map(({ kind, found }) => ({ kind, found })),
      [
        { kind: "fragment", found: 0 },
        { kind: "fragment", found: 0 },
      ],
    );
  });
});
