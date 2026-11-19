import {
  PREVIEW_CAPABILITIES,
  formatPreviewServedInstance,
  parsePreviewServedInstance,
  type PreviewCapability,
  type PreviewServedInstance,
  type PreviewServedInstanceReport,
} from "./preview-protocol";

/**
 * The preview bridge a start actually laid out: a digest of the bridge's own
 * workspace bytes, and the capabilities that laid-out bridge advertises.
 *
 * Read from the plan's files, never from this process's constants: an
 * editor and a sidecar of different versions disagree about both, and only
 * the files say which bridge a page will load.
 */
export type PreviewBridgeIdentity = Readonly<{
  buildId: string;
  capabilities: readonly PreviewCapability[];
}>;

/**
 * What a transport reports serving after a start: the bridge of the plan it
 * materialized, and the server instance that bridge is bound to.
 *
 * `instance` is null where the transport cannot name the server a page was
 * served by (a container, a framework's own dev server, a Start child that
 * did not confirm its name). Null there means unknown, never "the same".
 */
export type PreviewServing = Readonly<{
  bridge: PreviewBridgeIdentity;
  instance: PreviewServedInstance | null;
}>;

const BUILD_ID = /^[0-9a-f]{64}$/;
const MAX_BRIDGE_CAPABILITIES = 16;

/**
 * A bridge's capability list, or null unless every entry is a capability
 * this code knows, named once. Partial lists are not trimmed into a smaller
 * valid one: a list this side cannot read in full says nothing it can use.
 */
export function parsePreviewBridgeCapabilities(
  value: unknown,
): PreviewCapability[] | null {
  if (!Array.isArray(value) || value.length > MAX_BRIDGE_CAPABILITIES) {
    return null;
  }
  const known = PREVIEW_CAPABILITIES as readonly string[];
  const seen = new Set<string>();
  for (const token of value) {
    if (typeof token !== "string" || !known.includes(token) || seen.has(token)) {
      return null;
    }
    seen.add(token);
  }
  return [...value] as PreviewCapability[];
}

/**
 * A transport's `serving` report as it arrived over the wire. Null when there
 * is no well-formed `bridge` (not a record, no bridge, a malformed build id,
 * or a capability list that is missing, unknown or repeats an entry). A valid
 * bridge with a missing or malformed `instance` is kept, as
 * `{ bridge, instance: null }`: the bridge is known, the instance it was
 * served by is not. Either way "unknown" is never filled in: no capability or
 * instance is assumed here or by any caller.
 */
export function parsePreviewServing(value: unknown): PreviewServing | null {
  if (!isRecord(value) || !isRecord(value.bridge)) return null;
  const { buildId, capabilities } = value.bridge;
  if (typeof buildId !== "string" || !BUILD_ID.test(buildId)) return null;
  const parsed = parsePreviewBridgeCapabilities(capabilities);
  if (!parsed) return null;
  const instance =
    value.instance === null || value.instance === undefined
      ? null
      : parsePreviewServedInstance(value.instance);
  return { bridge: { buildId, capabilities: parsed }, instance };
}

/**
 * What is known about the bridge an earlier frame was served, against the
 * serving report `current`:
 *
 * - `same`: the frame names the instance `current` names, or an instance
 *   this tab was told served the same build;
 * - `changed`: an instance this tab was told served another build;
 * - `unknown`: anything else — no known report from the frame, a frame
 *   loaded from two instances, an instance this tab has no record of, no
 *   readable serving report. Unknown is never read as either of the others.
 *
 * `seen` holds what serving reports said, by the instance they named; a
 * report that named none (a container) is never in it.
 */
export function previousPreviewBridgeVersion(
  frame: PreviewServedInstanceReport | null,
  current: PreviewServing | null,
  seen: ReadonlyMap<string, PreviewBridgeIdentity>,
): "same" | "changed" | "unknown" {
  if (!current || frame?.kind !== "known") return "unknown";
  const served = formatPreviewServedInstance(frame.instance);
  if (
    current.instance &&
    formatPreviewServedInstance(current.instance) === served
  ) {
    return "same";
  }
  const recorded = seen.get(served);
  if (!recorded) return "unknown";
  return recorded.buildId === current.bridge.buildId ? "same" : "changed";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
