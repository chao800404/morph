import {
  resolveThemeContentCapabilitiesFromFiles,
  type ThemeContentCapabilityResolution,
} from "./theme-content-capability-resolver";
import {
  deriveThemeSourceContract,
  type ThemeSourceContractDerivation,
} from "./theme-source-contract";
import type { ThemeComponentContentCapability } from "./theme-content-capabilities";

/** Bump when source-index derivation changes incompatibly. */
export const THEME_SOURCE_INDEX_DERIVATION_VERSION = 1 as const;

export type ThemeSourceIndexStatus =
  | "complete"
  | "incomplete"
  | "unsupported";

export type ThemeSourceIndexKey = Readonly<{
  scope: "workspace" | "revision";
  sourceGeneration?: number;
  digestSet?: string;
  derivationVersion: typeof THEME_SOURCE_INDEX_DERIVATION_VERSION;
}>;

export type ThemeSourceIndex = Readonly<{
  derivationVersion: typeof THEME_SOURCE_INDEX_DERIVATION_VERSION;
  key: ThemeSourceIndexKey;
  status: ThemeSourceIndexStatus;
  diagnostics: readonly string[];
  sourceScan: ThemeContentCapabilityResolution["sourceScan"];
  capabilities: Readonly<Record<string, ThemeComponentContentCapability>>;
  sectionComponentRefs: Readonly<Record<string, string>>;
  sourceContract: ThemeSourceContractDerivation;
}>;

function normalizePath(path: string): string {
  return path.replace(/\\/g, "/").replace(/^\/+/, "");
}

function digestSet(
  sourceManifest:
    | Readonly<{
        version: 1;
        algorithm: "sha256";
        files: readonly Readonly<{ path: string; digest: string }>[];
      }>
    | null
    | undefined,
): string | null {
  if (
    !sourceManifest ||
    sourceManifest.version !== 1 ||
    sourceManifest.algorithm !== "sha256" ||
    !Array.isArray(sourceManifest.files)
  ) {
    return null;
  }
  const entries = sourceManifest.files
    .filter(
      (file) =>
        typeof file?.path === "string" &&
        typeof file.digest === "string" &&
        file.path.trim() !== "" &&
        file.digest.trim() !== "",
    )
    .map((file) => `${normalizePath(file.path)}:${file.digest}`)
    .sort();
  return entries.length === sourceManifest.files.length
    ? entries.join("|")
    : null;
}

function sourceSectionRefs(
  resolution: ThemeContentCapabilityResolution,
): Record<string, string> {
  const candidates = new Map<string, string[]>();
  for (const path of Object.keys(resolution.sourceScan.entries)) {
    const match = path.match(
      /^src\/components\/sections\/([^/]+?)(?:\/index)?\.(?:tsx|jsx)$/,
    );
    if (!match) continue;
    const type = match[1]!
      .replace(/([a-z0-9])([A-Z])/g, "$1-$2")
      .replace(/[^a-zA-Z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .toLowerCase();
    const paths = candidates.get(type) ?? [];
    paths.push(path);
    candidates.set(type, paths);
  }
  return Object.fromEntries(
    [...candidates.entries()]
      .filter(([, paths]) => paths.length === 1)
      .map(([type, paths]) => [type, paths[0]!]),
  );
}

/**
 * Derives the source-owned index without reading morph.theme.json.
 *
 * The caller may persist the returned JSON, but it must always be treated as
 * a cache keyed by source generation/digest set, never as client-provided
 * authorization. An incomplete or unsupported index is intentionally useful:
 * it tells a mutation to stop rather than silently falling back to guessing.
 */
export function deriveThemeSourceIndex(args: {
  files: ReadonlyArray<{ path: string; content?: string | null }>;
  scope: "workspace" | "revision";
  sourceGeneration?: number;
  sourceManifest?: Readonly<{
    version: 1;
    algorithm: "sha256";
    files: readonly Readonly<{ path: string; digest: string }>[];
  }> | null;
}): ThemeSourceIndex {
  const resolution = resolveThemeContentCapabilitiesFromFiles(args.files, {
    includeManifestFallback: false,
  });
  const sourceContract = deriveThemeSourceContract(args.files);
  const diagnostics = [
    ...resolution.diagnostics,
    ...sourceContract.diagnostics,
  ];
  const status: ThemeSourceIndexStatus =
    resolution.sourceScan.completeness === "incomplete"
      ? "incomplete"
      : diagnostics.length > 0 ||
          Object.values(resolution.sourceScan.entries).some(
            (entry) => entry.status === "invalid" || entry.status === "unreadable",
          )
        ? "unsupported"
        : "complete";
  const revisionDigestSet = digestSet(args.sourceManifest);
  const key: ThemeSourceIndexKey =
    args.scope === "revision"
      ? {
          scope: "revision",
          digestSet: revisionDigestSet ?? "invalid",
          derivationVersion: THEME_SOURCE_INDEX_DERIVATION_VERSION,
        }
      : {
          scope: "workspace",
          sourceGeneration: args.sourceGeneration ?? -1,
          derivationVersion: THEME_SOURCE_INDEX_DERIVATION_VERSION,
        };

  return {
    derivationVersion: THEME_SOURCE_INDEX_DERIVATION_VERSION,
    key,
    status,
    diagnostics,
    sourceScan: resolution.sourceScan,
    capabilities: resolution.capabilities,
    sectionComponentRefs: sourceSectionRefs(resolution),
    sourceContract,
  };
}

