import { parse } from "@babel/parser";
import { parseColocatedContentFields } from "./ast/theme-content-fields-source";
import { inferThemeContentFields } from "./ast/infer-theme-content-fields";
import {
  isArrayContentField,
  isScalarContentField,
  type ThemeContentFieldDefinition,
  type ThemeScalarContentFieldDefinition,
} from "./theme-content-capabilities";
import {
  parseThemeContentCapabilities,
  type ThemeComponentContentCapability,
  type ThemeContentCapabilities,
  type ThemeContentCapabilityParseResult,
} from "./theme-content-capabilities";
import {
  isThemeSectionSourcePath,
  readThemeSectionEntry,
} from "./theme-section-convention";

const THEME_MANIFEST_PATH = "morph.theme.json";
export const MAX_SCANNED_COMPONENT_SOURCES = 200;

export type ThemeContentSourceStatus =
  "declared" | "inferred" | "forwarded" | "invalid" | "absent" | "unreadable";

export type ThemeContentSourceScan = Readonly<{
  scope: "workspace" | "selected";
  completeness: "complete" | "incomplete";
  scannedSourceCount: number;
  eligibleSourceCount: number;
  limit: number;
  entries: Readonly<
    Record<
      string,
      Readonly<{
        status: ThemeContentSourceStatus;
        capability?: ThemeComponentContentCapability;
      }>
    >
  >;
  capabilities: Readonly<Record<string, ThemeComponentContentCapability>>;
}>;

export type ThemeContentCapabilityResolution =
  ThemeContentCapabilityParseResult &
    Readonly<{
      sourceScan: ThemeContentSourceScan;
    }>;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Resolves a relative import specifier against the file that declared it. */
function resolveRowComponentPath(
  declaringPath: string,
  specifier: string,
): string | null {
  const base = declaringPath.slice(0, declaringPath.lastIndexOf("/"));
  const segments = `${base}/${specifier}`.split("/");
  const resolved: string[] = [];
  for (const segment of segments) {
    if (segment === "" || segment === ".") continue;
    if (segment === "..") {
      if (resolved.length === 0) return null;
      resolved.pop();
      continue;
    }
    resolved.push(segment);
  }
  const path = resolved.join("/");
  return path.startsWith("src/") ? path : null;
}

/**
 * Returns the local module that supplies a re-exported content contract.
 *
 * A section entry may be a deliberately thin adapter around an implementation
 * component. Treating `export { contentFields } from "../Hero"` as a contract
 * alias keeps the folder convention from forcing authors to duplicate field
 * declarations in adapter files.
 */
function readReExportedContentFieldsSpecifier(source: string): string | null {
  if (!source.includes("contentFields")) return null;
  try {
    const ast = parse(source, {
      sourceType: "module",
      plugins: ["jsx", "typescript"],
    });
    for (const statement of ast.program.body as any[]) {
      if (
        statement.type !== "ExportNamedDeclaration" ||
        !statement.source ||
        typeof statement.source.value !== "string"
      ) {
        continue;
      }
      const exportsContentFields = (statement.specifiers ?? []).some(
        (specifier: any) => {
          const exported = specifier.exported;
          return (
            (exported?.type === "Identifier" &&
              exported.name === "contentFields") ||
            (exported?.type === "StringLiteral" &&
              exported.value === "contentFields")
          );
        },
      );
      if (exportsContentFields) return statement.source.value;
    }
  } catch {
    // The normal source parser owns diagnostics for malformed contentFields.
    // A forwarding hint that cannot be parsed is simply not an alias.
  }
  return null;
}

function resolveLocalModulePathFromFiles(
  declaringPath: string,
  specifier: string,
  filePaths: ReadonlySet<string>,
): string | null {
  const base = resolveRowComponentPath(declaringPath, specifier);
  if (!base) return null;
  for (const candidate of [
    base,
    `${base}.tsx`,
    `${base}.jsx`,
    `${base}/index.tsx`,
    `${base}/index.jsx`,
  ]) {
    if (filePaths.has(candidate)) return candidate;
  }
  return null;
}

/**
 * Row fields the referenced component declares.
 *
 * Only scalar fields are taken: a row component that itself declares a list
 * would make the row a list of lists, which the schema rejects for the same
 * reason Sanity does — an editor cannot tell which level they are editing.
 */
function resolveRowFields(
  declaringPath: string,
  specifier: string,
  declared: ReadonlyMap<string, Record<string, ThemeContentFieldDefinition>>,
): Record<string, ThemeScalarContentFieldDefinition> | null {
  const base = resolveRowComponentPath(declaringPath, specifier);
  if (!base) return null;
  for (const extension of ROW_COMPONENT_EXTENSIONS) {
    const fields = declared.get(`${base}${extension}`);
    if (!fields) continue;
    const scalars: Record<string, ThemeScalarContentFieldDefinition> = {};
    for (const [key, definition] of Object.entries(fields)) {
      if (isScalarContentField(definition)) scalars[key] = definition;
    }
    return Object.keys(scalars).length > 0 ? scalars : null;
  }
  return null;
}

/** Extensions a row component reference may omit. */
const ROW_COMPONENT_EXTENSIONS = [
  "",
  ".tsx",
  ".jsx",
  "/index.tsx",
  "/index.jsx",
];

/**
 * Maps each declared componentRef to the source file that implements it.
 *
 * Read separately from the capability parse because the manifest's role here is
 * only to say where a component lives; what it exposes for editing is answered
 * by the component's own source.
 */
export function readComponentSourcePaths(
  manifestContent: string | null | undefined,
): ReadonlyMap<string, string> {
  if (!manifestContent) return new Map();
  let parsed: unknown;
  try {
    parsed = JSON.parse(manifestContent);
  } catch {
    return new Map();
  }
  if (!isRecord(parsed) || !isRecord(parsed.components)) return new Map();

  const sources = new Map<string, string>();
  for (const [componentRef, config] of Object.entries(parsed.components)) {
    if (sources.size >= MAX_SCANNED_COMPONENT_SOURCES) break;
    if (!isRecord(config)) continue;
    const source = config.source;
    if (typeof source !== "string" || source.trim() === "") continue;
    sources.set(componentRef, source.replace(/\\/g, "/").replace(/^\/+/, ""));
  }
  return sources;
}

/**
 * Section mappings the manifest declares for components that only became
 * editable through a co-located declaration.
 *
 * The manifest parse drops a section mapping whose component has no
 * manifest-declared fields, so a component that declares its fields in source
 * would lose its section binding. Recovering it here keeps both declaration
 * styles equivalent.
 */
function readSectionComponentRefs(
  manifestContent: string | null | undefined,
  capabilities: Record<string, ThemeComponentContentCapability>,
): Record<string, string> {
  if (!manifestContent) return {};
  let parsed: unknown;
  try {
    parsed = JSON.parse(manifestContent);
  } catch {
    return {};
  }
  if (!isRecord(parsed) || !isRecord(parsed.sections)) return {};

  const mappings: Record<string, string> = {};
  for (const [sectionType, rawSection] of Object.entries(parsed.sections)) {
    if (!isRecord(rawSection)) continue;
    const componentRef = rawSection.componentRef;
    if (typeof componentRef !== "string" || !capabilities[componentRef]) {
      continue;
    }
    mappings[sectionType] = componentRef;
  }
  return mappings;
}

function mergeCapabilities(
  manifestContent: string | null | undefined,
  manifestResult: ThemeContentCapabilityParseResult,
  colocated: Map<string, ThemeComponentContentCapability>,
  diagnostics: string[],
): ThemeContentCapabilityParseResult {
  const capabilities: Record<string, ThemeComponentContentCapability> = {
    ...manifestResult.capabilities,
  };
  for (const [componentRef, capability] of colocated) {
    capabilities[componentRef] = capability;
  }
  return {
    capabilities: capabilities as ThemeContentCapabilities,
    sectionComponentRefs: {
      ...readSectionComponentRefs(manifestContent, capabilities),
      ...manifestResult.sectionComponentRefs,
    },
    diagnostics: [...manifestResult.diagnostics, ...diagnostics],
  };
}

/**
 * Fills in row shapes declared by reference.
 *
 * Run after every declaration is known, so a referenced row component may
 * itself be declared later in the scan. Both entry points share this: when only
 * one of them expanded `of`, the editor rendered row controls the server then
 * refused to write, reporting the list as having no declared row shape.
 */
function expandRowReferences({
  declared,
  invalidDeclarations,
  colocated,
  diagnostics,
  componentRefForPath,
}: {
  declared: Map<string, Record<string, ThemeContentFieldDefinition>>;
  invalidDeclarations: Set<string>;
  colocated: Map<string, ThemeComponentContentCapability>;
  diagnostics: string[];
  componentRefForPath: (path: string) => string | null;
}): void {
  // A module whose declaration could not be read exposes nothing. Recorded as
  // an explicit empty capability rather than left out, because leaving it out
  // is what let the manifest answer in its place.
  for (const path of invalidDeclarations) {
    const capability = { fields: {} };
    colocated.set(path, capability);
    const componentRef = componentRefForPath(path);
    if (componentRef) colocated.set(componentRef, capability);
  }

  for (const [path, fields] of declared) {
    const resolvedFields: Record<string, ThemeContentFieldDefinition> = {};
    for (const [fieldKey, definition] of Object.entries(fields)) {
      if (!isArrayContentField(definition) || definition.fields) {
        resolvedFields[fieldKey] = definition;
        continue;
      }
      const specifier = definition.of;
      const rowFields = specifier
        ? resolveRowFields(path, specifier, declared)
        : null;
      if (!rowFields) {
        // Dropped rather than left shapeless: an editor offering a list whose
        // rows have no fields cannot do anything useful with it, and silence
        // here is how a mistyped path would go unnoticed.
        diagnostics.push(
          `${path}: content field "${fieldKey}" references "${specifier ?? ""}", which declares no content fields.`,
        );
        continue;
      }
      resolvedFields[fieldKey] = { ...definition, fields: rowFields };
    }
    // No early exit on an empty result: a declaration that resolves to nothing
    // is the module saying it exposes nothing, which has to override the
    // manifest rather than defer to it.
    const capability = { fields: resolvedFields };
    // Keyed by source path so an unregistered component resolves, and by its
    // manifest ref as well so existing Document sections keep resolving.
    colocated.set(path, capability);
    const componentRef = componentRefForPath(path);
    if (componentRef) colocated.set(componentRef, capability);
  }
}

function expandReExportedContentFields({
  byPath,
  manifestResult,
  manifestRefsBySource,
  colocated,
}: {
  byPath: ReadonlyMap<string, string | null | undefined>;
  manifestResult: ThemeContentCapabilityParseResult;
  manifestRefsBySource: ReadonlyMap<string, string>;
  colocated: Map<string, ThemeComponentContentCapability>;
}): void {
  const filePaths = new Set(byPath.keys());
  const entries = [...byPath.entries()];

  // A short fixed point handles an adapter around another adapter while
  // keeping this source-only resolution bounded by the workspace file count.
  for (let pass = 0; pass < entries.length; pass += 1) {
    let changed = false;
    for (const [path, source] of entries) {
      if (typeof source !== "string") continue;
      const specifier = readReExportedContentFieldsSpecifier(source);
      if (!specifier) continue;
      const targetPath = resolveLocalModulePathFromFiles(
        path,
        specifier,
        filePaths,
      );
      if (!targetPath) continue;
      const targetRef = manifestRefsBySource.get(targetPath);
      const capability =
        colocated.get(targetPath) ??
        (targetRef ? manifestResult.capabilities[targetRef] : undefined);
      if (!capability || colocated.get(path) === capability) continue;
      colocated.set(path, capability);
      changed = true;
    }
    if (!changed) return;
  }
}

function buildSourceScan({
  byPath,
  statuses,
  colocated,
  scope,
  eligibleSourceCount,
  scannedSourceCount,
}: {
  byPath: ReadonlyMap<string, string | null | undefined>;
  statuses: ReadonlyMap<string, ThemeContentSourceStatus>;
  colocated: ReadonlyMap<string, ThemeComponentContentCapability>;
  scope: "workspace" | "selected";
  eligibleSourceCount: number;
  scannedSourceCount: number;
}): ThemeContentSourceScan {
  const entries: Record<
    string,
    {
      status: ThemeContentSourceStatus;
      capability?: ThemeComponentContentCapability;
    }
  > = {};
  const capabilities: Record<string, ThemeComponentContentCapability> = {};

  for (const [path] of byPath) {
    const status = statuses.get(path);
    if (!status) continue;
    const capability = colocated.get(path);
    entries[path] = capability ? { status, capability } : { status };
    if (capability) capabilities[path] = capability;
  }

  return {
    scope,
    completeness:
      scannedSourceCount < eligibleSourceCount ? "incomplete" : "complete",
    scannedSourceCount,
    eligibleSourceCount,
    limit: MAX_SCANNED_COMPONENT_SOURCES,
    entries,
    capabilities,
  };
}

/** Candidate paths a row component reference may resolve to. */
export function rowComponentCandidatePaths(
  declaringPath: string,
  specifier: string,
): string[] {
  const base = resolveRowComponentPath(declaringPath, specifier);
  if (!base) return [];
  return ROW_COMPONENT_EXTENSIONS.map((extension) => `${base}${extension}`);
}

/**
 * Resolves what each component exposes for content editing.
 *
 * A component's own `contentFields` export wins over the manifest: the
 * declaration lives in the same file as the component it describes, so it
 * cannot drift from the props that component actually accepts, and a
 * customer-authored component becomes editable without registering it anywhere.
 * The manifest remains a compatibility source for components that have not
 * declared their fields yet.
 */
export function resolveThemeContentCapabilitiesFromFiles(
  themeFiles: ReadonlyArray<{ path: string; content?: string | null }>,
  options: { includeManifestFallback?: boolean } = {},
): ThemeContentCapabilityResolution {
  const byPath = new Map(
    themeFiles.map((file) => [file.path.replace(/\\/g, "/"), file.content]),
  );
  const includeManifestFallback = options.includeManifestFallback !== false;
  const manifestContent = includeManifestFallback
    ? (byPath.get(THEME_MANIFEST_PATH) ?? null)
    : null;
  const manifestResult = parseThemeContentCapabilities(manifestContent);

  const colocated = new Map<string, ThemeComponentContentCapability>();
  const diagnostics: string[] = [];

  // Every component source is scanned, not only the ones the manifest names.
  // Registration is what makes a growing Theme unmanageable: a component that
  // declares its own fields is editable because it declares them, not because
  // someone remembered to list it. Its source path is its identity.
  const manifestRefsBySource = new Map<string, string>();
  if (includeManifestFallback) {
    for (const [componentRef, sourcePath] of readComponentSourcePaths(
      manifestContent,
    )) {
      manifestRefsBySource.set(sourcePath, componentRef);
    }
  }

  const declared = new Map<
    string,
    Record<string, ThemeContentFieldDefinition>
  >();
  const invalidDeclarations = new Set<string>();
  const sourceStatuses = new Map<string, ThemeContentSourceStatus>();
  const eligibleSourcePaths = [...byPath.keys()]
    .filter((path) => path.startsWith("src/") && /\.(tsx|jsx)$/.test(path))
    .sort();
  const scannedSourcePaths = eligibleSourcePaths.slice(
    0,
    MAX_SCANNED_COMPONENT_SOURCES,
  );
  for (const path of scannedSourcePaths) {
    const source = byPath.get(path);
    if (typeof source !== "string") {
      sourceStatuses.set(path, "unreadable");
      continue;
    }
    const parsed = parseColocatedContentFields(source);
    for (const diagnostic of parsed.diagnostics) {
      diagnostics.push(`${path}: ${diagnostic}`);
    }
    // `valid` wins even when empty — that is how a module withdraws a field the
    // manifest still lists. `invalid` is recorded too, so the merge below can
    // refuse to fall back rather than serving a stale capability.
    if (parsed.declaration === "valid") {
      sourceStatuses.set(path, "declared");
      declared.set(path, parsed.fields ?? {});
    } else if (parsed.declaration === "invalid") {
      sourceStatuses.set(path, "invalid");
      invalidDeclarations.add(path);
    } else if (isThemeSectionSourcePath(path)) {
      // A section-folder component may use ordinary React props without a
      // second contentFields declaration. The inference is intentionally
      // limited to this convention and only exposes static primitive props;
      // explicit contentFields remains authoritative for richer shapes.
      const inferred = inferThemeContentFields(source);
      if (Object.keys(inferred.fields).length > 0) {
        sourceStatuses.set(path, "inferred");
        declared.set(path, inferred.fields);
      } else {
        sourceStatuses.set(path, "absent");
      }
    } else {
      sourceStatuses.set(path, "absent");
    }
  }

  expandRowReferences({
    declared,
    invalidDeclarations,
    colocated,
    diagnostics,
    componentRefForPath: (path) => manifestRefsBySource.get(path) ?? null,
  });
  expandReExportedContentFields({
    byPath,
    manifestResult,
    manifestRefsBySource,
    colocated,
  });

  for (const path of scannedSourcePaths) {
    if (sourceStatuses.get(path) === "absent" && colocated.has(path)) {
      sourceStatuses.set(path, "forwarded");
    }
  }

  const merged = mergeCapabilities(
    manifestContent,
    manifestResult,
    colocated,
    diagnostics,
  );
  let resolved = merged;
  if (!includeManifestFallback) {
    const sectionCandidates = new Map<string, string[]>();
    for (const path of scannedSourcePaths) {
      const entry = readThemeSectionEntry(path);
      if (!entry || !colocated.has(path)) continue;
      const candidates = sectionCandidates.get(entry.sectionType) ?? [];
      candidates.push(path);
      sectionCandidates.set(entry.sectionType, candidates);
    }
    resolved = {
      ...merged,
      sectionComponentRefs: Object.fromEntries(
        [...sectionCandidates.entries()]
          .filter(([, candidates]) => candidates.length === 1)
          .map(([type, candidates]) => [type, candidates[0]!]),
      ),
    };
  }
  return {
    ...resolved,
    sourceScan: buildSourceScan({
      byPath,
      statuses: sourceStatuses,
      colocated,
      scope: "workspace",
      eligibleSourceCount: eligibleSourcePaths.length,
      scannedSourceCount: scannedSourcePaths.length,
    }),
  };
}

/**
 * Same resolution for callers that hold only the manifest and can read
 * individual sources on demand, such as a server mutation that must not load
 * the whole workspace.
 */
export async function resolveThemeContentCapabilities(args: {
  manifestContent: string | null | undefined;
  readSource: (path: string) => Promise<string | null | undefined>;
  additionalSourcePaths?: readonly string[];
}): Promise<ThemeContentCapabilityResolution> {
  const manifestResult = parseThemeContentCapabilities(args.manifestContent);
  const colocated = new Map<string, ThemeComponentContentCapability>();
  const diagnostics: string[] = [];

  const sources = new Map(readComponentSourcePaths(args.manifestContent));
  for (const sourcePath of args.additionalSourcePaths ?? []) {
    const normalized = sourcePath.replace(/\\/g, "/").replace(/^\/+/, "");
    if (normalized.startsWith("src/") && /\.(?:tsx|jsx)$/.test(normalized)) {
      sources.set(normalized, normalized);
    }
  }
  const sourceRefByPath = new Map<string, string>();
  const selectedSourcePaths = new Map<string, string | null>();
  const sourceContents = new Map<string, string>();
  for (const [componentRef, sourcePath] of sources) {
    sourceRefByPath.set(sourcePath, componentRef);
    const source = await args.readSource(sourcePath);
    selectedSourcePaths.set(
      sourcePath,
      typeof source === "string" ? source : null,
    );
    if (typeof source === "string") sourceContents.set(sourcePath, source);
  }

  // Section entry adapters may forward the implementation's contentFields.
  // Fetch their local target as well so server-side validation sees the same
  // contract as the editor's whole-workspace resolver.
  for (const [sourcePath, source] of [...sourceContents]) {
    const specifier = readReExportedContentFieldsSpecifier(source);
    if (!specifier) continue;
    const base = resolveRowComponentPath(sourcePath, specifier);
    if (!base) continue;
    for (const candidate of [
      base,
      `${base}.tsx`,
      `${base}.jsx`,
      `${base}/index.tsx`,
      `${base}/index.jsx`,
    ]) {
      if (sourceContents.has(candidate)) break;
      const targetSource = await args.readSource(candidate);
      if (typeof targetSource !== "string") continue;
      selectedSourcePaths.set(candidate, targetSource);
      sourceContents.set(candidate, targetSource);
      break;
    }
  }
  const declared = new Map<
    string,
    Record<string, ThemeContentFieldDefinition>
  >();
  const invalidDeclarations = new Set<string>();
  const refForPath = new Map<string, string>();
  const sourceStatuses = new Map<string, ThemeContentSourceStatus>();
  for (const [sourcePath, source] of sourceContents) {
    const componentRef = sourceRefByPath.get(sourcePath) ?? sourcePath;
    const parsed = parseColocatedContentFields(source);
    for (const diagnostic of parsed.diagnostics) {
      diagnostics.push(`${sourcePath}: ${diagnostic}`);
    }
    if (parsed.declaration === "invalid") {
      sourceStatuses.set(sourcePath, "invalid");
      invalidDeclarations.add(sourcePath);
      if (componentRef !== sourcePath) refForPath.set(sourcePath, componentRef);
      continue;
    }
    if (parsed.declaration === "valid") {
      sourceStatuses.set(sourcePath, "declared");
      declared.set(sourcePath, parsed.fields ?? {});
    } else if (isThemeSectionSourcePath(sourcePath)) {
      const inferred = inferThemeContentFields(source);
      if (Object.keys(inferred.fields).length > 0) {
        sourceStatuses.set(sourcePath, "inferred");
        declared.set(sourcePath, inferred.fields);
      } else {
        sourceStatuses.set(sourcePath, "absent");
      }
    } else {
      sourceStatuses.set(sourcePath, "absent");
      continue;
    }
    // A route is allowed to be the only registration for a component. In that
    // case its source path becomes the persisted component identity, and
    // server validation must resolve the same co-located declaration the
    // editor used.
    if (componentRef !== sourcePath) refForPath.set(sourcePath, componentRef);
  }

  // A row shape declared by reference lives in a file the manifest never names,
  // so it has to be fetched before the shape can be resolved. Only paths a
  // declaration actually points at are read; the client cannot choose them.
  for (const [path, fields] of [...declared]) {
    for (const definition of Object.values(fields)) {
      if (!isArrayContentField(definition) || definition.fields) continue;
      if (!definition.of) continue;
      for (const candidate of rowComponentCandidatePaths(path, definition.of)) {
        if (declared.has(candidate)) break;
        const rowSource = await args.readSource(candidate);
        if (typeof rowSource !== "string") continue;
        const parsedRow = parseColocatedContentFields(rowSource);
        for (const diagnostic of parsedRow.diagnostics) {
          diagnostics.push(`${candidate}: ${diagnostic}`);
        }
        if (parsedRow.fields) {
          declared.set(candidate, parsedRow.fields);
          break;
        }
      }
    }
  }

  expandRowReferences({
    declared,
    invalidDeclarations,
    colocated,
    diagnostics,
    componentRefForPath: (path) => refForPath.get(path) ?? null,
  });

  for (const [sourcePath, source] of sourceContents) {
    const specifier = readReExportedContentFieldsSpecifier(source);
    if (!specifier) continue;
    const base = resolveRowComponentPath(sourcePath, specifier);
    if (!base) continue;
    const targetPath = [
      base,
      `${base}.tsx`,
      `${base}.jsx`,
      `${base}/index.tsx`,
      `${base}/index.jsx`,
    ].find((candidate) => sourceContents.has(candidate));
    if (!targetPath) continue;
    const targetRef = sourceRefByPath.get(targetPath);
    const capability =
      colocated.get(targetPath) ??
      (targetRef ? manifestResult.capabilities[targetRef] : undefined);
    if (capability) colocated.set(sourcePath, capability);
  }

  for (const sourcePath of sourceContents.keys()) {
    if (
      sourceStatuses.get(sourcePath) === "absent" &&
      colocated.has(sourcePath)
    ) {
      sourceStatuses.set(sourcePath, "forwarded");
    }
  }

  const merged = mergeCapabilities(
    args.manifestContent,
    manifestResult,
    colocated,
    diagnostics,
  );
  return {
    ...merged,
    sourceScan: buildSourceScan({
      byPath: selectedSourcePaths,
      statuses: new Map(
        [...selectedSourcePaths.keys()].map((path) => [
          path,
          sourceStatuses.get(path) ?? "unreadable",
        ]),
      ),
      colocated,
      scope: "selected",
      eligibleSourceCount: selectedSourcePaths.size,
      scannedSourceCount: selectedSourcePaths.size,
    }),
  };
}
