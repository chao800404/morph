import {
  parseThemeContentCapabilities,
  type ThemeComponentContentCapability,
} from "./theme-content-capabilities";
import {
  readComponentSourcePaths,
  resolveThemeContentCapabilitiesFromFiles,
  type ThemeContentCapabilityResolution,
  type ThemeContentSourceScan,
} from "./theme-content-capability-resolver";
import {
  deriveThemeSourceContract,
  type ThemeSourceContractDerivation,
} from "./theme-source-contract";

/** Bump when the source-to-capability derivation rules change. */
export const THEME_CONTENT_DERIVATION_VERSION = 1 as const;

export type ThemeContentShadowClassification =
  | "equivalent"
  | "source-derived-manifest-drift"
  | "manifest-only"
  | "unsupported";

export type ThemeSourceContractComparisonStatus =
  | "equivalent"
  | "drift"
  | "manifest-only"
  | "unsupported"
  | "not-declared";

export type ThemeSourceContractComparison = Readonly<{
  status: ThemeSourceContractComparisonStatus;
  differences: readonly string[];
}>;

export type ThemeComponentRefAudit = Readonly<{
  total: number;
  resolved: number;
  unresolved: number;
  missingRef: number;
  unresolvedRefs: readonly string[];
}>;

export type ThemeContentShadowEntry = Readonly<{
  componentRef: string | null;
  sourcePath: string | null;
  classification: ThemeContentShadowClassification;
  manifestFields: readonly string[];
  sourceFields: readonly string[];
  reasons: readonly string[];
}>;

export type ThemeContentWorkspaceSourceKey = Readonly<{
  scope: "workspace";
  sourceGeneration: number;
  derivationVersion: typeof THEME_CONTENT_DERIVATION_VERSION;
}>;

export type ThemeContentRevisionSourceKey = Readonly<{
  scope: "revision";
  digestSet: string;
  derivationVersion: typeof THEME_CONTENT_DERIVATION_VERSION;
}>;

export type ThemeContentSourceKey =
  | ThemeContentWorkspaceSourceKey
  | ThemeContentRevisionSourceKey;

export type ThemeContentShadowReport = Readonly<{
  derivationVersion: typeof THEME_CONTENT_DERIVATION_VERSION;
  sourceKey: ThemeContentSourceKey;
  sourceScan: ThemeContentSourceScan;
  entries: readonly ThemeContentShadowEntry[];
  summary: Readonly<Record<ThemeContentShadowClassification, number>>;
  diagnostics: readonly string[];
  migrationGate: "pass" | "blocked";
  migrationBlockers: readonly string[];
  /** Separate gate for deleting the authored manifest file. */
  manifestRemovalGate: "pass" | "blocked";
  manifestRemovalBlockers: readonly string[];
  sourceContract: Readonly<{
    derivation: ThemeSourceContractDerivation;
    comparisons: Readonly<{
      entry: ThemeSourceContractComparison;
      router: ThemeSourceContractComparison;
      documentLayout: ThemeSourceContractComparison;
      components: ThemeSourceContractComparison;
      sections: ThemeSourceContractComparison;
    }>;
  }>;
  draftComponentRefs?: ThemeComponentRefAudit;
  historicalComponentRefs?: ThemeComponentRefAudit;
  draftSourceComponentRefs?: ThemeComponentRefAudit;
  historicalSourceComponentRefs?: ThemeComponentRefAudit;
}>;

export type ThemeDocumentComponentRef = Readonly<{
  componentRef?: string | null;
}>;

/** Reads section refs from an untrusted stored document without guessing. */
export function extractThemeDocumentComponentRefs(
  document: unknown,
): ThemeDocumentComponentRef[] {
  if (!document || typeof document !== "object" || Array.isArray(document)) {
    return [];
  }
  const sections = (document as Record<string, unknown>).sections;
  if (!Array.isArray(sections)) return [];
  return sections.flatMap((section) => {
    if (!section || typeof section !== "object" || Array.isArray(section)) {
      return [];
    }
    const componentRef = (section as Record<string, unknown>).componentRef;
    return componentRef === undefined ||
      componentRef === null ||
      typeof componentRef === "string"
      ? [{ componentRef: componentRef as string | null | undefined }]
      : [];
  });
}

function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, entry]) => [key, canonicalize(entry)]),
  );
}

function manifestRecord(
  manifestContent: string | null | undefined,
): Record<string, unknown> | null {
  if (!manifestContent) return null;
  try {
    const parsed: unknown = JSON.parse(manifestContent);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
}

function manifestSourcePath(value: unknown): string | null {
  if (typeof value === "string") return value.replace(/\\/g, "/").trim();
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  const source = record.source ?? record.path;
  return typeof source === "string"
    ? source.replace(/\\/g, "/").trim()
    : null;
}

function contractComparison(
  status: ThemeSourceContractComparisonStatus,
  differences: readonly string[] = [],
): ThemeSourceContractComparison {
  return { status, differences: [...differences] };
}

function compareSourceContract(args: {
  manifestContent: string | null | undefined;
  files: ReadonlyArray<{ path: string; content?: string | null }>;
  derivation: ThemeSourceContractDerivation;
}): {
  entry: ThemeSourceContractComparison;
  router: ThemeSourceContractComparison;
  documentLayout: ThemeSourceContractComparison;
  components: ThemeSourceContractComparison;
  sections: ThemeSourceContractComparison;
} {
  const manifest = manifestRecord(args.manifestContent);
  const contract = args.derivation.contract;
  const filePaths = new Set(
    args.files.map((file) => file.path.replace(/\\/g, "/")),
  );

  const entry =
    manifest?.entry === undefined
      ? contractComparison("not-declared")
      : contract.entry === null
        ? contractComparison("unsupported", [
            "The source entry could not be derived.",
          ])
        : manifest.entry === contract.entry
          ? contractComparison("equivalent")
          : contractComparison("drift", [
              `Manifest entry is "${String(manifest.entry)}" but source derives "${contract.entry}".`,
            ]);

  const router =
    manifest?.router === undefined
      ? contractComparison("not-declared")
      : contract.router === null
        ? contractComparison("unsupported", [
            "The source router contract could not be derived.",
          ])
        : JSON.stringify(canonicalize(manifest.router)) ===
            JSON.stringify(canonicalize(contract.router))
          ? contractComparison("equivalent")
          : contractComparison("drift", [
              "Manifest router metadata differs from the source-owned router contract.",
            ]);

  const manifestLayout =
    manifest &&
    manifest.documentLayout &&
    typeof manifest.documentLayout === "object" &&
    !Array.isArray(manifest.documentLayout)
      ? manifestSourcePath(manifest.documentLayout)
      : null;
  const documentLayout =
    manifest?.documentLayout === undefined
      ? contractComparison("not-declared")
      : contract.documentLayout === null
        ? contractComparison("unsupported", [
            "The source document layout could not be derived.",
          ])
        : manifestLayout === contract.documentLayout.source
          ? contractComparison("equivalent")
          : contractComparison("drift", [
              `Manifest document layout is "${manifestLayout ?? "missing"}" but source derives "${contract.documentLayout.source}".`,
            ]);

  const derivedComponentSources = new Set(
    contract.components.map((component) => component.sourcePath),
  );
  const componentDifferences: string[] = [];
  let componentStatus: ThemeSourceContractComparisonStatus = "equivalent";
  const manifestComponents =
    manifest &&
    manifest.components &&
    typeof manifest.components === "object" &&
    !Array.isArray(manifest.components)
      ? Object.entries(manifest.components as Record<string, unknown>)
      : [];
  for (const [componentRef, rawConfig] of manifestComponents) {
    const sourcePath = manifestSourcePath(rawConfig);
    if (!sourcePath || !filePaths.has(sourcePath)) {
      componentStatus = "unsupported";
      componentDifferences.push(
        `Manifest component "${componentRef}" has no readable source path.`,
      );
      continue;
    }
    if (!derivedComponentSources.has(sourcePath)) {
      if (componentStatus !== "unsupported") componentStatus = "manifest-only";
      componentDifferences.push(
        `Manifest component "${componentRef}" at "${sourcePath}" is not proven by the source contract.`,
      );
    }
  }
  if (args.derivation.categories.sections === "unsupported") {
    componentStatus = "unsupported";
    componentDifferences.push("Source section/component discovery is incomplete.");
  }

  const derivedSectionSources = new Set(
    contract.sections.map((section) => section.sourcePath),
  );
  const sectionDifferences: string[] = [];
  let sectionStatus: ThemeSourceContractComparisonStatus = "equivalent";
  const manifestSections =
    manifest &&
    manifest.sections &&
    typeof manifest.sections === "object" &&
    !Array.isArray(manifest.sections)
      ? Object.entries(manifest.sections as Record<string, unknown>)
      : [];
  for (const [sectionType, rawConfig] of manifestSections) {
    const sourcePath = manifestSourcePath(rawConfig);
    if (!sourcePath || !filePaths.has(sourcePath)) {
      sectionStatus = "unsupported";
      sectionDifferences.push(
        `Manifest section "${sectionType}" has no readable source path.`,
      );
      continue;
    }
    if (!derivedSectionSources.has(sourcePath)) {
      if (sectionStatus !== "unsupported") sectionStatus = "manifest-only";
      sectionDifferences.push(
        `Manifest section "${sectionType}" at "${sourcePath}" is not proven by an authored slot.`,
      );
    }
  }
  if (args.derivation.categories.sections === "unsupported") {
    sectionStatus = "unsupported";
  }

  return {
    entry,
    router,
    documentLayout,
    components: contractComparison(componentStatus, componentDifferences),
    sections: contractComparison(sectionStatus, sectionDifferences),
  };
}

function sameCapability(
  left: ThemeComponentContentCapability | undefined,
  right: ThemeComponentContentCapability | undefined,
): boolean {
  return (
    JSON.stringify(canonicalize(left ?? { fields: {} })) ===
    JSON.stringify(canonicalize(right ?? { fields: {} }))
  );
}

function fieldNames(
  capability: ThemeComponentContentCapability | undefined,
): string[] {
  return Object.keys(capability?.fields ?? {}).sort();
}

function pushEntry(
  entries: ThemeContentShadowEntry[],
  entry: ThemeContentShadowEntry,
) {
  entries.push({
    ...entry,
    manifestFields: [...entry.manifestFields].sort(),
    sourceFields: [...entry.sourceFields].sort(),
    reasons: [...entry.reasons],
  });
}

/**
 * Audits document refs against the same source-derived capability universe the
 * migration will use. Missing refs are measured separately from unresolved
 * refs: old documents without a componentRef are a compatibility case, not a
 * broken reference.
 */
export function auditThemeComponentRefs(args: {
  refs: readonly ThemeDocumentComponentRef[];
  knownRefs: ReadonlySet<string>;
}): ThemeComponentRefAudit {
  const unresolvedRefs = new Set<string>();
  let resolved = 0;
  let missingRef = 0;

  for (const section of args.refs) {
    const componentRef = section.componentRef?.trim();
    if (!componentRef) {
      missingRef += 1;
    } else if (args.knownRefs.has(componentRef)) {
      resolved += 1;
    } else {
      unresolvedRefs.add(componentRef);
    }
  }

  return {
    total: args.refs.length,
    resolved,
    unresolved: args.refs.length - missingRef - resolved,
    missingRef,
    unresolvedRefs: [...unresolvedRefs].sort(),
  };
}

function knownReferenceSet(
  manifestContent: string | null | undefined,
  resolution: ThemeContentCapabilityResolution,
): Set<string> {
  const known = new Set<string>();
  for (const path of Object.keys(resolution.sourceScan.capabilities)) {
    known.add(path);
  }
  for (const [componentRef, sourcePath] of readComponentSourcePaths(
    manifestContent,
  )) {
    const entry = resolution.sourceScan.entries[sourcePath];
    if (
      entry?.capability &&
      entry.status !== "invalid" &&
      entry.status !== "unreadable"
    ) {
      known.add(componentRef);
    }
  }
  return known;
}

function sourceReferenceSet(
  resolution: ThemeContentCapabilityResolution,
): Set<string> {
  return new Set(Object.keys(resolution.sourceScan.capabilities));
}

function revisionDigestSet(
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
  const files = sourceManifest.files
    .filter(
      (file) =>
        file &&
        typeof file.path === "string" &&
        typeof file.digest === "string" &&
        file.path.trim() !== "" &&
        file.digest.trim() !== "",
    )
    .map((file) => `${file.path.replace(/\\/g, "/")}:${file.digest}`)
    .sort();
  return files.length === sourceManifest.files.length ? files.join("|") : null;
}

function reportFromResolution(args: {
  manifestContent: string | null | undefined;
  files: ReadonlyArray<{ path: string; content?: string | null }>;
  resolution: ThemeContentCapabilityResolution;
  sourceGeneration: number;
  sourceManifest?: Readonly<{
    version: 1;
    algorithm: "sha256";
    files: readonly Readonly<{ path: string; digest: string }>[];
  }> | null;
  draftRefs?: readonly ThemeDocumentComponentRef[];
  historicalRefs?: readonly ThemeDocumentComponentRef[];
}): ThemeContentShadowReport {
  const manifest = parseThemeContentCapabilities(args.manifestContent);
  const sourcePaths = readComponentSourcePaths(args.manifestContent);
  const manifestRefBySourcePath = new Map(
    [...sourcePaths].map(([componentRef, sourcePath]) => [
      sourcePath,
      componentRef,
    ]),
  );
  const entries: ThemeContentShadowEntry[] = [];
  const seenSourcePaths = new Set<string>();

  for (const [componentRef, sourcePath] of sourcePaths) {
    const manifestCapability = manifest.capabilities[componentRef];
    const sourceEntry = args.resolution.sourceScan.entries[sourcePath];
    const sourceCapability = sourceEntry?.capability;
    const sourceKnown = sourceEntry !== undefined;

    if (
      !sourceKnown &&
      args.resolution.sourceScan.completeness === "incomplete"
    ) {
      pushEntry(entries, {
        componentRef,
        sourcePath,
        classification: "unsupported",
        manifestFields: fieldNames(manifestCapability),
        sourceFields: [],
        reasons: [
          "Source scan is incomplete; this component was not proven safe to derive.",
        ],
      });
      continue;
    }

    if (!sourceEntry || sourceEntry.status === "absent" || !sourceCapability) {
      pushEntry(entries, {
        componentRef,
        sourcePath,
        classification: "manifest-only",
        manifestFields: fieldNames(manifestCapability),
        sourceFields: [],
        reasons: [
          sourceEntry?.status === "absent"
            ? "The source has no supported content declaration."
            : "The manifest points to a source that was not available to derivation.",
        ],
      });
      continue;
    }

    seenSourcePaths.add(sourcePath);
    if (
      sourceEntry.status === "invalid" ||
      sourceEntry.status === "unreadable"
    ) {
      pushEntry(entries, {
        componentRef,
        sourcePath,
        classification: "unsupported",
        manifestFields: fieldNames(manifestCapability),
        sourceFields: fieldNames(sourceCapability),
        reasons: [
          `Source declaration is ${sourceEntry.status} and cannot be trusted.`,
        ],
      });
      continue;
    }

    pushEntry(entries, {
      componentRef,
      sourcePath,
      classification: sameCapability(manifestCapability, sourceCapability)
        ? "equivalent"
        : "source-derived-manifest-drift",
      manifestFields: fieldNames(manifestCapability),
      sourceFields: fieldNames(sourceCapability),
      reasons: sameCapability(manifestCapability, sourceCapability)
        ? []
        : ["The source-derived content contract differs from the manifest."],
    });
  }

  for (const [sourcePath, sourceEntry] of Object.entries(
    args.resolution.sourceScan.entries,
  )) {
    if (!sourceEntry.capability || seenSourcePaths.has(sourcePath)) continue;
    const componentRef = manifestRefBySourcePath.get(sourcePath) ?? null;
    const manifestCapability = componentRef
      ? manifest.capabilities[componentRef]
      : undefined;
    pushEntry(entries, {
      componentRef,
      sourcePath,
      classification:
        sourceEntry.status === "invalid" || sourceEntry.status === "unreadable"
          ? "unsupported"
          : "source-derived-manifest-drift",
      manifestFields: fieldNames(manifestCapability),
      sourceFields: fieldNames(sourceEntry.capability),
      reasons: componentRef
        ? ["The source-derived contract is not equivalent to the manifest."]
        : [
            "The source declares an editable contract without a manifest entry.",
          ],
    });
  }

  const summary: Record<ThemeContentShadowClassification, number> = {
    equivalent: 0,
    "source-derived-manifest-drift": 0,
    "manifest-only": 0,
    unsupported: 0,
  };
  for (const entry of entries) summary[entry.classification] += 1;

  const diagnostics = [...manifest.diagnostics, ...args.resolution.diagnostics];
  const sourceContractDerivation = deriveThemeSourceContract(args.files);
  const sourceContractComparisons = compareSourceContract({
    manifestContent: args.manifestContent,
    files: args.files,
    derivation: sourceContractDerivation,
  });
  const migrationBlockers: string[] = [];
  const digestSet = revisionDigestSet(args.sourceManifest);
  if (args.sourceManifest && !digestSet) {
    migrationBlockers.push(
      "The immutable source manifest is incomplete and cannot key this audit.",
    );
  }
  if (args.resolution.sourceScan.completeness === "incomplete") {
    migrationBlockers.push(
      `Source scan is incomplete (${args.resolution.sourceScan.scannedSourceCount}/${args.resolution.sourceScan.eligibleSourceCount} eligible files scanned).`,
    );
  }
  if (diagnostics.length > 0) {
    migrationBlockers.push("Capability derivation produced diagnostics.");
  }
  if (summary.unsupported > 0) {
    migrationBlockers.push("At least one component cannot be derived safely.");
  }
  if (summary["manifest-only"] > 0) {
    migrationBlockers.push(
      "At least one manifest capability has no reliable source-derived equivalent.",
    );
  }
  if (summary["source-derived-manifest-drift"] > 0) {
    migrationBlockers.push(
      "At least one source-derived capability differs from the manifest.",
    );
  }
  if (!sourceContractDerivation.complete) {
    migrationBlockers.push("Source contract derivation produced diagnostics.");
  }
  for (const [category, result] of Object.entries(
    sourceContractComparisons,
  )) {
    if (result.status !== "equivalent" && result.status !== "not-declared") {
      migrationBlockers.push(
        `Source contract ${category} comparison is ${result.status}.`,
      );
    }
  }

  const knownRefs = knownReferenceSet(args.manifestContent, args.resolution);
  const sourceRefs = sourceReferenceSet(args.resolution);
  const draftSourceComponentRefs = args.draftRefs
    ? auditThemeComponentRefs({ refs: args.draftRefs, knownRefs: sourceRefs })
    : undefined;
  const historicalSourceComponentRefs = args.historicalRefs
    ? auditThemeComponentRefs({
        refs: args.historicalRefs,
        knownRefs: sourceRefs,
      })
    : undefined;
  const manifestRemovalBlockers: string[] = [];
  const hasManifest = Boolean(args.manifestContent?.trim());
  if (hasManifest) {
    if (args.resolution.sourceScan.completeness === "incomplete") {
      manifestRemovalBlockers.push(
        "The source capability scan is incomplete; deleting the manifest would make the write contract incomplete.",
      );
    }
    if (summary.unsupported > 0) {
      manifestRemovalBlockers.push(
        "At least one manifest declaration is invalid or unreadable in source.",
      );
    }
    if (summary["manifest-only"] > 0 || summary["source-derived-manifest-drift"] > 0) {
      manifestRemovalBlockers.push(
        "The source-derived capability contract is not equivalent to the authored manifest.",
      );
    }
    if (!sourceContractDerivation.complete) {
      manifestRemovalBlockers.push(
        "The source-owned route/component contract is not complete.",
      );
    }
    for (const [category, result] of Object.entries(
      sourceContractComparisons,
    )) {
      if (result.status !== "equivalent" && result.status !== "not-declared") {
        manifestRemovalBlockers.push(
          `Source contract ${category} must be equivalent before manifest removal.`,
        );
      }
    }
    if ((draftSourceComponentRefs?.unresolved ?? 0) > 0) {
      manifestRemovalBlockers.push(
        "Draft Documents still contain component references that source cannot resolve.",
      );
    }
    if ((historicalSourceComponentRefs?.unresolved ?? 0) > 0) {
      manifestRemovalBlockers.push(
        "Historical Documents still contain component references that source cannot resolve; immutable history will not be rewritten.",
      );
    }
  }
  return {
    derivationVersion: THEME_CONTENT_DERIVATION_VERSION,
    sourceKey: digestSet
      ? {
          scope: "revision",
          digestSet,
          derivationVersion: THEME_CONTENT_DERIVATION_VERSION,
        }
      : {
          scope: "workspace",
          sourceGeneration: args.sourceGeneration,
          derivationVersion: THEME_CONTENT_DERIVATION_VERSION,
        },
    sourceScan: args.resolution.sourceScan,
    entries: entries.sort((left, right) =>
      `${left.sourcePath ?? ""}:${left.componentRef ?? ""}`.localeCompare(
        `${right.sourcePath ?? ""}:${right.componentRef ?? ""}`,
      ),
    ),
    summary,
    diagnostics,
    migrationGate: migrationBlockers.length === 0 ? "pass" : "blocked",
    migrationBlockers,
    manifestRemovalGate:
      manifestRemovalBlockers.length === 0 ? "pass" : "blocked",
    manifestRemovalBlockers,
    sourceContract: {
      derivation: sourceContractDerivation,
      comparisons: sourceContractComparisons,
    },
    ...(args.draftRefs
      ? {
          draftComponentRefs: auditThemeComponentRefs({
            refs: args.draftRefs,
            knownRefs,
          }),
        }
      : {}),
    ...(args.historicalRefs
      ? {
          historicalComponentRefs: auditThemeComponentRefs({
            refs: args.historicalRefs,
            knownRefs,
          }),
        }
      : {}),
    ...(draftSourceComponentRefs
      ? { draftSourceComponentRefs }
      : {}),
    ...(historicalSourceComponentRefs
      ? { historicalSourceComponentRefs }
      : {}),
  };
}

/**
 * Builds the read-only shadow report for a complete workspace snapshot.
 *
 * This deliberately keeps the manifest in the comparison path. It is an
 * oracle for existing Themes during migration, never a write authorization
 * source and never a request to mutate a Document.
 */
export function buildThemeContentShadowReport(args: {
  files: ReadonlyArray<{ path: string; content?: string | null }>;
  sourceGeneration: number;
  sourceManifest?: Readonly<{
    version: 1;
    algorithm: "sha256";
    files: readonly Readonly<{ path: string; digest: string }>[];
  }> | null;
  draftRefs?: readonly ThemeDocumentComponentRef[];
  historicalRefs?: readonly ThemeDocumentComponentRef[];
}): ThemeContentShadowReport {
  const manifestContent = args.files.find(
    (file) => file.path.replace(/\\/g, "/") === "morph.theme.json",
  )?.content;
  const resolution = resolveThemeContentCapabilitiesFromFiles(args.files);
  return reportFromResolution({
    manifestContent,
    files: args.files,
    resolution,
    sourceGeneration: args.sourceGeneration,
    sourceManifest: args.sourceManifest,
    draftRefs: args.draftRefs,
    historicalRefs: args.historicalRefs,
  });
}
