import { GENERATED_PREVIEW_BRIDGE_SOURCES } from "./preview-bridge-sources.generated";
import { THEME_PREVIEW_BRIDGE_PATH } from "./theme-preview-bridge-entry";
import { THEME_PREVIEW_START_CLIENT_PATH } from "./theme-preview-start-runtime";
import { THEME_PREVIEW_CONTENT_MODULE_PATH } from "./theme-preview-content";
import { sha256 } from "./theme-compiler-hasher";
import {
  parsePreviewBridgeCapabilities,
  type PreviewBridgeIdentity,
} from "../editor/preview-serving";

/**
 * How the bridge entry declares what it implements. Read back from the laid
 * out entry, so the capabilities reported are the ones in the file a page
 * will load.
 */
const BRIDGE_CAPABILITIES_DECLARATION =
  "const BRIDGE_CAPABILITIES: readonly PreviewCapability[] = ";

type PlannedFile = Readonly<{ path: string }> &
  Readonly<{ content?: string; binary?: unknown }>;

/**
 * The bridge a preview plan lays out, from the plan's own files.
 *
 * Only platform bridge code counts: the generated protocol modules, the
 * bridge entry, the content module, and for a Start preview its client
 * entry. The content snapshot, the Theme's own files, the generated config
 * and the source generation are left out, so saving the Theme never makes a
 * new bridge. Null when any of those files is missing or its declaration
 * cannot be read: the bridge is then unknown.
 */
export function previewBridgeIdentity(
  workspaceFiles: readonly PlannedFile[],
  workspaceRoot: string,
  options: Readonly<{ startPreview: boolean }>,
): PreviewBridgeIdentity | null {
  const byPath = new Map(workspaceFiles.map((file) => [file.path, file]));
  const paths = [
    ...GENERATED_PREVIEW_BRIDGE_SOURCES.map((module) => module.path),
    THEME_PREVIEW_BRIDGE_PATH,
    THEME_PREVIEW_CONTENT_MODULE_PATH,
    ...(options.startPreview ? [THEME_PREVIEW_START_CLIENT_PATH] : []),
  ];
  const files: { path: string; content: string }[] = [];
  for (const relative of paths) {
    const file = byPath.get(`${workspaceRoot}/${relative}`);
    if (!file || typeof file.content !== "string") return null;
    files.push({ path: relative, content: file.content });
  }
  const entry = files.find((file) => file.path === THEME_PREVIEW_BRIDGE_PATH);
  const capabilities = entry ? bridgeEntryCapabilities(entry.content) : null;
  if (!capabilities) return null;
  return {
    buildId: sha256(JSON.stringify({ format: 1, files })),
    capabilities,
  };
}

/** The capability list a bridge entry declares, or null if it is not one list. */
export function bridgeEntryCapabilities(source: string) {
  const at = source.indexOf(BRIDGE_CAPABILITIES_DECLARATION);
  if (at < 0) return null;
  if (source.indexOf(BRIDGE_CAPABILITIES_DECLARATION, at + 1) >= 0) return null;
  const from = at + BRIDGE_CAPABILITIES_DECLARATION.length;
  const end = source.indexOf("];", from);
  if (end < 0) return null;
  try {
    return parsePreviewBridgeCapabilities(
      JSON.parse(source.slice(from, end + 1)),
    );
  } catch {
    return null;
  }
}
