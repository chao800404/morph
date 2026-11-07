/**
 * The editor's side of the Live Preview authorization flow (#214 P2;
 * handoff/2026-10-28/preview-access-design.md §4a, addendum A1).
 *
 * For a preview served from its `pv-` host, the editor frames that host's
 * begin page first. Begin reports a binder hash for a flow the editor
 * started; the editor asks Morph for a code bound to it and posts the code
 * back to that frame. Redeem then sets the frame's credential and sends it
 * on to the preview itself.
 *
 * A begin message is answered only when the editor is waiting on that very
 * flow, it comes from the exact window the editor framed, on the preview's
 * origin, and the flow is younger than its lifetime. A flow is answered at
 * most once; after that, or after a failure or timeout, it is over, so a
 * Theme document later loaded on the same origin can post begin messages as
 * often as it likes and never receive a code.
 */

export const LIVE_PREVIEW_ACCESS_BEGIN_PATH = "/__morph/preview-auth/begin";
export const LIVE_PREVIEW_ACCESS_BEGIN_MESSAGE = "morph:preview-auth-begin";
export const LIVE_PREVIEW_ACCESS_CODE_MESSAGE = "morph:preview-auth-code";
export const LIVE_PREVIEW_ACCESS_FAILED_MESSAGE = "morph:preview-auth-failed";
/** A preview document refused for want of access tells its editor so. */
export const LIVE_PREVIEW_ACCESS_ENDED_MESSAGE = "morph:preview-access-ended";
/** As long as an exchange code lives. */
export const LIVE_PREVIEW_ACCESS_FLOW_TTL_MS = 60_000;
export const LIVE_PREVIEW_ACCESS_FAILED_NOTICE =
  "Preview sign-in expired. Retry Preview.";
export const LIVE_PREVIEW_ACCESS_ENDED_NOTICE =
  "Preview access ended. Retry Preview.";

const FLOW_ID = /^[0-9a-f]{32}$/;
const HASH = /^[0-9a-f]{64}$/;

/** A fresh, random, non-secret id for one authorization attempt. */
export function newLivePreviewAccessFlowId(): string {
  return Array.from(crypto.getRandomValues(new Uint8Array(16)), (byte) =>
    byte.toString(16).padStart(2, "0"),
  ).join("");
}

/**
 * The begin page for a framed preview address: on the preview's own origin,
 * returning afterwards to that address's path and query. A tab the editor
 * opens (#214 P3) runs the same flow in `tab` mode, with its own grant.
 */
export function livePreviewAccessBeginUrl(args: {
  framedUrl: string;
  flowId: string;
  editorOrigin: string;
  mode?: "iframe" | "tab";
}): string {
  const framed = new URL(args.framedUrl);
  const begin = new URL(LIVE_PREVIEW_ACCESS_BEGIN_PATH, framed.origin);
  begin.searchParams.set("flow", args.flowId);
  begin.searchParams.set("return", `${framed.pathname}${framed.search}`);
  begin.searchParams.set("editorOrigin", args.editorOrigin);
  if (args.mode === "tab") begin.searchParams.set("mode", "tab");
  return begin.toString();
}

/**
 * A preview tab the editor opened, and the flow it is running. Its window
 * is dropped once the flow ends, so the editor keeps no handle on a tab
 * that now runs Theme code.
 */
export type LivePreviewAccessTab = {
  readonly flow: LivePreviewAccessFlow;
  window: unknown;
};

export type LivePreviewAccessFlow = {
  readonly flowId: string;
  readonly startedAt: number;
  /** Set once the flow has been answered, failed or timed out. */
  ended: boolean;
};

export function startLivePreviewAccessFlow(
  now: number,
  flowId: string = newLivePreviewAccessFlowId(),
): LivePreviewAccessFlow {
  return { flowId, startedAt: now, ended: false };
}

type IncomingMessage = Readonly<{
  data: unknown;
  origin: string;
  source: unknown;
}>;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function fromFramedWindow(
  message: IncomingMessage,
  expected: Readonly<{ origin: string; window: unknown }>,
): boolean {
  return (
    expected.window !== null &&
    message.source === expected.window &&
    message.origin === expected.origin
  );
}

/**
 * The binder hash to issue a code for, when this message is the begin page
 * of the flow being waited on; null for anything else. Accepting it ends
 * the flow, so it is answered once.
 */
export function acceptLivePreviewAccessBegin(
  flow: LivePreviewAccessFlow | null,
  message: IncomingMessage,
  expected: Readonly<{ origin: string; window: unknown }>,
  now: number,
): string | null {
  if (!flow || flow.ended) return null;
  if (!fromFramedWindow(message, expected)) return null;
  const data = message.data;
  if (
    !isRecord(data) ||
    data.type !== LIVE_PREVIEW_ACCESS_BEGIN_MESSAGE ||
    data.flowId !== flow.flowId ||
    typeof data.binderHash !== "string" ||
    !HASH.test(data.binderHash)
  ) {
    return null;
  }
  if (now - flow.startedAt >= LIVE_PREVIEW_ACCESS_FLOW_TTL_MS) {
    flow.ended = true;
    return null;
  }
  flow.ended = true;
  return data.binderHash;
}

/** Whether this message is the framed flow's own redeem failure. */
export function isLivePreviewAccessFailure(
  flow: LivePreviewAccessFlow | null,
  message: IncomingMessage,
  expected: Readonly<{ origin: string; window: unknown }>,
): boolean {
  if (!flow || !fromFramedWindow(message, expected)) return false;
  const data = message.data;
  return (
    isRecord(data) &&
    data.type === LIVE_PREVIEW_ACCESS_FAILED_MESSAGE &&
    data.flowId === flow.flowId
  );
}

/** The message that hands a code to the framed begin page. */
export function livePreviewAccessCodeMessage(
  flow: LivePreviewAccessFlow,
  code: string,
): { type: string; flowId: string; code: string } {
  if (!FLOW_ID.test(flow.flowId)) throw new Error("Invalid flow id.");
  return { type: LIVE_PREVIEW_ACCESS_CODE_MESSAGE, flowId: flow.flowId, code };
}

/** Whether the framed document says its access was refused. */
export function isLivePreviewAccessEnded(
  message: IncomingMessage,
  expected: Readonly<{ origin: string; window: unknown }>,
): boolean {
  if (!fromFramedWindow(message, expected)) return false;
  const data = message.data;
  return isRecord(data) && data.type === LIVE_PREVIEW_ACCESS_ENDED_MESSAGE;
}
