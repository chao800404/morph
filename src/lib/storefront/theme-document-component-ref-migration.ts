import type { StorefrontPageDocument } from "@/db/storefront.schema";
import { storefrontPageDocumentSchema } from "@/lib/validations/storefront-page";

type ThemeSourceFile = Readonly<{ path: string }>;

export type ThemeDocumentComponentRefMigration = Readonly<{
  ok: true;
  document: StorefrontPageDocument;
  rewrites: readonly Readonly<{
    from: string;
    to: string;
    sectionId: string;
  }>[];
}>;

export type ThemeDocumentComponentRefMigrationFailure = Readonly<{
  ok: false;
  reason:
    | "invalid-document"
    | "invalid-manifest"
    | "duplicate-manifest-ref"
    | "missing-source"
    | "unknown-component-ref";
  message: string;
  componentRef?: string;
  sectionId?: string;
}>;

export type ThemeDocumentComponentRefMigrationResult =
  | ThemeDocumentComponentRefMigration
  | ThemeDocumentComponentRefMigrationFailure;

function normalizePath(path: string): string {
  return path.replace(/\\/g, "/").replace(/^\/+/, "").trim();
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function readSource(value: unknown): string | null {
  if (typeof value === "string") return normalizePath(value);
  if (!isRecord(value)) return null;
  const source = value.source ?? value.path;
  return typeof source === "string" ? normalizePath(source) : null;
}

/**
 * Reads only exact component-ref mappings from the legacy manifest.
 *
 * This is intentionally not a type/name heuristic. A migration may rewrite a
 * stored ref only when the manifest explicitly names that ref and gives it a
 * source path; all other refs fail closed.
 */
export function readExactManifestComponentRefs(
  manifestContent: string | null | undefined,
):
  | { ok: true; refs: ReadonlyMap<string, string> }
  | ThemeDocumentComponentRefMigrationFailure {
  if (typeof manifestContent !== "string" || manifestContent.trim() === "") {
    return {
      ok: false,
      reason: "invalid-manifest",
      message: "Theme manifest is missing; exact component refs cannot be migrated.",
    };
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(manifestContent);
  } catch {
    return {
      ok: false,
      reason: "invalid-manifest",
      message: "Theme manifest is not valid JSON.",
    };
  }
  if (!isRecord(parsed)) {
    return {
      ok: false,
      reason: "invalid-manifest",
      message: "Theme manifest must be a JSON object.",
    };
  }

  const components = parsed.components;
  if (!isRecord(components)) {
    return {
      ok: false,
      reason: "invalid-manifest",
      message: "Theme manifest has no exact components map.",
    };
  }

  const refs = new Map<string, string>();
  for (const [componentRef, rawConfig] of Object.entries(components)) {
    const sourcePath = readSource(rawConfig);
    if (!sourcePath) continue;
    const previous = refs.get(componentRef);
    if (previous && previous !== sourcePath) {
      return {
        ok: false,
        reason: "duplicate-manifest-ref",
        message: `Manifest component ref "${componentRef}" maps to more than one source path.`,
        componentRef,
      };
    }
    refs.set(componentRef, sourcePath);
  }
  return { ok: true, refs };
}

/**
 * Rewrites a validated Document using exact legacy manifest mappings.
 *
 * Source-path refs are already migrated and remain unchanged. Missing refs are
 * a legacy compatibility case and remain unchanged; non-path refs must be in
 * the exact manifest map or the whole operation is rejected.
 */
export function migrateThemeDocumentComponentRefs(args: {
  document: unknown;
  manifestContent: string | null | undefined;
  files: readonly ThemeSourceFile[];
}): ThemeDocumentComponentRefMigrationResult {
  const parsedDocument = storefrontPageDocumentSchema.safeParse(args.document);
  if (!parsedDocument.success) {
    return {
      ok: false,
      reason: "invalid-document",
      message: "Stored Theme Document is invalid and cannot be migrated.",
    };
  }

  const manifestResult = readExactManifestComponentRefs(args.manifestContent);
  if (!manifestResult.ok) return manifestResult;

  const sourcePaths = new Set(args.files.map((file) => normalizePath(file.path)));
  const rewrites: Array<{ from: string; to: string; sectionId: string }> = [];
  let sections: StorefrontPageDocument["sections"];
  try {
    sections = parsedDocument.data.sections.map((section) => {
      const componentRef = section.componentRef?.trim() ?? "";
      if (!componentRef) return section;

      if (componentRef.startsWith("src/")) {
        if (!sourcePaths.has(normalizePath(componentRef))) {
          throw new MigrationFailure({
            ok: false,
            reason: "missing-source",
            message: `Document section "${section.id}" points to missing source "${componentRef}".`,
            componentRef,
            sectionId: section.id,
          });
        }
        return {
          ...section,
          componentRef,
        };
      }

      const sourcePath = manifestResult.refs.get(componentRef);
      if (!sourcePath) {
        throw new MigrationFailure({
          ok: false,
          reason: "unknown-component-ref",
          message: `Document section "${section.id}" uses component ref "${componentRef}", but the manifest has no exact mapping for it.`,
          componentRef,
          sectionId: section.id,
        });
      }
      if (!sourcePaths.has(sourcePath)) {
        throw new MigrationFailure({
          ok: false,
          reason: "missing-source",
          message: `Manifest component ref "${componentRef}" points to missing source "${sourcePath}".`,
          componentRef,
          sectionId: section.id,
        });
      }
      rewrites.push({ from: componentRef, to: sourcePath, sectionId: section.id });
      return { ...section, componentRef: sourcePath };
    });
  } catch (error) {
    if (error instanceof MigrationFailure) return error.failure;
    throw error;
  }

  return {
    ok: true,
    document: { ...parsedDocument.data, sections },
    rewrites,
  };
}

class MigrationFailure extends Error {
  readonly failure: ThemeDocumentComponentRefMigrationFailure;

  constructor(failure: ThemeDocumentComponentRefMigrationFailure) {
    super(failure.message);
    this.failure = failure;
  }
}
