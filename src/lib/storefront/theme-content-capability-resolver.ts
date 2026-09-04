import { parseColocatedContentFields } from "./ast/theme-content-fields-source";
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

const THEME_MANIFEST_PATH = "morph.theme.json";
const MAX_SCANNED_COMPONENT_SOURCES = 200;

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
const ROW_COMPONENT_EXTENSIONS = ["", ".tsx", ".jsx", "/index.tsx", "/index.jsx"];

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
  colocated,
  diagnostics,
  componentRefForPath,
}: {
  declared: Map<string, Record<string, ThemeContentFieldDefinition>>;
  colocated: Map<string, ThemeComponentContentCapability>;
  diagnostics: string[];
  componentRefForPath: (path: string) => string | null;
}): void {
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
    if (Object.keys(resolvedFields).length === 0) continue;
    const capability = { fields: resolvedFields };
    // Keyed by source path so an unregistered component resolves, and by its
    // manifest ref as well so existing Document sections keep resolving.
    colocated.set(path, capability);
    const componentRef = componentRefForPath(path);
    if (componentRef) colocated.set(componentRef, capability);
  }
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
): ThemeContentCapabilityParseResult {
  const byPath = new Map(
    themeFiles.map((file) => [file.path.replace(/\\/g, "/"), file.content]),
  );
  const manifestContent = byPath.get(THEME_MANIFEST_PATH) ?? null;
  const manifestResult = parseThemeContentCapabilities(manifestContent);

  const colocated = new Map<string, ThemeComponentContentCapability>();
  const diagnostics: string[] = [];

  // Every component source is scanned, not only the ones the manifest names.
  // Registration is what makes a growing Theme unmanageable: a component that
  // declares its own fields is editable because it declares them, not because
  // someone remembered to list it. Its source path is its identity.
  const manifestRefsBySource = new Map<string, string>();
  for (const [componentRef, sourcePath] of readComponentSourcePaths(
    manifestContent,
  )) {
    manifestRefsBySource.set(sourcePath, componentRef);
  }

  const declared = new Map<
    string,
    Record<string, ThemeContentFieldDefinition>
  >();
  let scanned = 0;
  for (const [path, source] of byPath) {
    if (scanned >= MAX_SCANNED_COMPONENT_SOURCES) break;
    if (typeof source !== "string") continue;
    if (!path.startsWith("src/") || !/\.(tsx|jsx)$/.test(path)) continue;
    scanned += 1;
    const parsed = parseColocatedContentFields(source);
    for (const diagnostic of parsed.diagnostics) {
      diagnostics.push(`${path}: ${diagnostic}`);
    }
    if (!parsed.fields) continue;
    declared.set(path, parsed.fields);
  }

  expandRowReferences({
    declared,
    colocated,
    diagnostics,
    componentRefForPath: (path) => manifestRefsBySource.get(path) ?? null,
  });

  return mergeCapabilities(
    manifestContent,
    manifestResult,
    colocated,
    diagnostics,
  );
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
}): Promise<ThemeContentCapabilityParseResult> {
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
  const declared = new Map<
    string,
    Record<string, ThemeContentFieldDefinition>
  >();
  const refForPath = new Map<string, string>();
  for (const [componentRef, sourcePath] of sources) {
    const source = await args.readSource(sourcePath);
    if (typeof source !== "string") continue;
    const parsed = parseColocatedContentFields(source);
    for (const diagnostic of parsed.diagnostics) {
      diagnostics.push(`${sourcePath}: ${diagnostic}`);
    }
    if (!parsed.fields) continue;
    declared.set(sourcePath, parsed.fields);
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
    colocated,
    diagnostics,
    componentRefForPath: (path) => refForPath.get(path) ?? null,
  });

  return mergeCapabilities(
    args.manifestContent,
    manifestResult,
    colocated,
    diagnostics,
  );
}
