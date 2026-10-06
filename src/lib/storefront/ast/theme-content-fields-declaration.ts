import {
  parseColocatedContentFields,
  type ColocatedContentFieldsResult,
} from "./theme-content-fields-source";

/**
 * Where a component's content fields are declared.
 *
 * A component may declare them in its own source (`export const
 * contentFields`) or in a sibling `<Name>.fields.ts` holding the same
 * declaration. The sibling is the one rule every framework can follow — a Vue
 * `<script setup>` cannot export and an HTML file has no module — and it is
 * read with the same parser, so moving a declaration is a cut and paste
 * (docs/multi-runtime-theme-plan.md).
 *
 * Both files are only parsed. Nothing here imports or runs either of them.
 */

const COMPONENT_SOURCE = /^(src\/.+)\.(tsx|jsx)$/;
const SIDECAR_SUFFIX = ".fields.ts";

/** The sibling declaration file for a component source, or `null`. */
export function contentFieldsSidecarPath(componentPath: string): string | null {
  const match = COMPONENT_SOURCE.exec(componentPath.replace(/\\/g, "/"));
  return match ? `${match[1]}${SIDECAR_SUFFIX}` : null;
}

export function isContentFieldsSidecarPath(path: string): boolean {
  const normalized = path.replace(/\\/g, "/");
  return normalized.startsWith("src/") && normalized.endsWith(SIDECAR_SUFFIX);
}

/** Equal as declarations: the same keys and values, in any key order. */
function sameDeclaration(left: unknown, right: unknown): boolean {
  if (left === right) return true;
  if (Array.isArray(left) || Array.isArray(right)) {
    return (
      Array.isArray(left) &&
      Array.isArray(right) &&
      left.length === right.length &&
      left.every((item, index) => sameDeclaration(item, right[index]))
    );
  }
  if (
    typeof left !== "object" ||
    typeof right !== "object" ||
    left === null ||
    right === null
  ) {
    return false;
  }
  const leftKeys = Object.keys(left);
  const rightKeys = Object.keys(right);
  return (
    leftKeys.length === rightKeys.length &&
    leftKeys.every(
      (key) =>
        Object.hasOwn(right, key) &&
        sameDeclaration(
          (left as Record<string, unknown>)[key],
          (right as Record<string, unknown>)[key],
        ),
    )
  );
}

export type ComponentContentFieldsResult = ColocatedContentFieldsResult &
  Readonly<{
    /** Which file the fields were read from; `null` when neither declares any. */
    origin: "component" | "sidecar" | null;
    /** Both files declare fields: `same` is used with a warning, `different` is refused. */
    duplicate: "same" | "different" | null;
  }>;

/**
 * A component's content fields, from its source and its sibling declaration.
 *
 * `sidecar` is the sibling file's content: `undefined` when there is no such
 * file, `null` when there is one that could not be read.
 *
 * Two declarations are never silently reconciled. Equal ones are used, with a
 * diagnostic asking for one to be removed; different ones make the component
 * `invalid` — nothing editable — because an author editing one of them could
 * not tell the other was the one in effect. Code mode still edits both files.
 */
export function readComponentContentFields(input: {
  path: string;
  source: string;
  sidecar?: string | null;
}): ComponentContentFieldsResult {
  const inline = parseColocatedContentFields(input.source);
  const sidecarPath = contentFieldsSidecarPath(input.path);
  if (input.sidecar === undefined || !sidecarPath) {
    return {
      ...inline,
      origin: inline.declaration === "valid" ? "component" : null,
      duplicate: null,
    };
  }

  const fail = (
    diagnostics: readonly string[],
    duplicate: "different" | null = null,
  ): ComponentContentFieldsResult => ({
    declaration: "invalid",
    fields: null,
    diagnostics,
    origin: null,
    duplicate,
  });

  if (input.sidecar === null) {
    return fail([`${sidecarPath} could not be read.`]);
  }
  const sidecar = parseColocatedContentFields(input.sidecar);
  if (sidecar.declaration === "absent") {
    return fail([
      `${sidecarPath} does not declare "export const contentFields = { ... }".`,
    ]);
  }
  if (sidecar.declaration === "invalid") {
    return fail(sidecar.diagnostics.map((message) => `${sidecarPath}: ${message}`));
  }

  if (inline.declaration === "absent") {
    return { ...sidecar, origin: "sidecar", duplicate: null };
  }
  if (inline.declaration === "invalid") {
    return fail(inline.diagnostics);
  }
  if (!sameDeclaration(inline.fields, sidecar.fields)) {
    return fail(
      [
        `contentFields is declared in both ${input.path} and ${sidecarPath}, and they differ. Design content editing is off for this component until one of them is removed.`,
      ],
      "different",
    );
  }
  return {
    ...sidecar,
    diagnostics: [
      ...sidecar.diagnostics,
      `contentFields is declared in both ${input.path} and ${sidecarPath}. They match; remove the one in ${input.path}.`,
    ],
    origin: "sidecar",
    duplicate: "same",
  };
}
