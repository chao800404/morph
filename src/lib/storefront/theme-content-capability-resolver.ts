import { parseColocatedContentFields } from "./ast/theme-content-fields-source";
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

  for (const [componentRef, sourcePath] of readComponentSourcePaths(
    manifestContent,
  )) {
    const source = byPath.get(sourcePath);
    if (typeof source !== "string") continue;
    const parsed = parseColocatedContentFields(source);
    for (const diagnostic of parsed.diagnostics) {
      diagnostics.push(`${sourcePath}: ${diagnostic}`);
    }
    if (parsed.fields) colocated.set(componentRef, { fields: parsed.fields });
  }

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
}): Promise<ThemeContentCapabilityParseResult> {
  const manifestResult = parseThemeContentCapabilities(args.manifestContent);
  const colocated = new Map<string, ThemeComponentContentCapability>();
  const diagnostics: string[] = [];

  for (const [componentRef, sourcePath] of readComponentSourcePaths(
    args.manifestContent,
  )) {
    const source = await args.readSource(sourcePath);
    if (typeof source !== "string") continue;
    const parsed = parseColocatedContentFields(source);
    for (const diagnostic of parsed.diagnostics) {
      diagnostics.push(`${sourcePath}: ${diagnostic}`);
    }
    if (parsed.fields) colocated.set(componentRef, { fields: parsed.fields });
  }

  return mergeCapabilities(
    args.manifestContent,
    manifestResult,
    colocated,
    diagnostics,
  );
}
