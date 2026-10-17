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

import { GUARDED_MESSAGES, scanSource } from "./preview-message-poster-scan.mjs";

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
const previewSelectionField = useCallback((fieldKey, fieldPath, value) => {
  postEditorToPreviewMessage(frame(), {
    type: "${FIELD}",
    fieldKey,
    fieldPath,
    value,
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
