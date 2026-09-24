import { logPreviewServerEvent } from "@/lib/storefront/compiler/preview-server-observation";

/**
 * What the preview proxy answered, for the requests that went wrong.
 *
 * A Live Preview page reaches its container through this Worker. When the
 * Sandbox SDK refuses a request it answers 410 with a generic code, and on one
 * of its two refusal paths it logs nothing at all — so a page that silently
 * never finished loading left no trace of which request failed, when, or what
 * the container was doing at the time. This records each error response (and
 * each very slow one) with the container's state as the SDK reports it.
 *
 * Observation only, and off the response path: it runs after the response is
 * handed back, and never delays or alters what the preview page receives.
 */

/** Responses slower than this are recorded even when they succeed. */
export const SLOW_PREVIEW_RESPONSE_MS = 5_000;
/** At most one container-state lookup per sandbox in this window. */
const STATE_LOOKUP_INTERVAL_MS = 2_000;
const STATE_LOOKUP_TIMEOUT_MS = 2_000;
const MAX_PATH_LENGTH = 300;

/**
 * The port and sandbox a preview host names, read the way the SDK reads it.
 *
 * The host is `<port>-<sandbox id>-<token>.<preview host>`. The token is the
 * preview's credential, so it is deliberately not returned.
 */
export function previewRouteFromHostname(
  hostname: string,
): { port: number; sandboxId: string } | null {
  const dot = hostname.indexOf(".");
  if (dot === -1) return null;
  const label = hostname.slice(0, dot);
  const firstHyphen = label.indexOf("-");
  const lastHyphen = label.lastIndexOf("-");
  if (firstHyphen === -1 || lastHyphen <= firstHyphen) return null;
  const portText = label.slice(0, firstHyphen);
  if (!/^\d{4,5}$/.test(portText)) return null;
  const sandboxId = label.slice(firstHyphen + 1, lastHyphen);
  if (!sandboxId) return null;
  return { port: Number(portText), sandboxId };
}

/** Whether a proxied preview response is worth a line, and which kind. */
export function previewResponseObservation(
  status: number,
  durationMs: number,
): "error" | "slow" | null {
  if (status >= 400) return "error";
  if (durationMs >= SLOW_PREVIEW_RESPONSE_MS) return "slow";
  return null;
}

/** The SDK's error code from a JSON error body, when it has one. */
export async function readPreviewErrorCode(
  response: Response,
): Promise<string | null> {
  if (!response.headers.get("content-type")?.includes("application/json")) {
    return null;
  }
  try {
    const body: unknown = await response.json();
    return body &&
      typeof body === "object" &&
      typeof (body as { code?: unknown }).code === "string"
      ? (body as { code: string }).code.slice(0, 80)
      : null;
  } catch {
    return null;
  }
}

const lastStateLookupAt = new Map<string, number>();

/**
 * Whether to spend a container-state lookup now. A refused page load arrives
 * as a burst of refusals, and one lookup describes the whole burst.
 */
export function claimStateLookup(sandboxId: string, now = Date.now()): boolean {
  const last = lastStateLookupAt.get(sandboxId);
  if (last !== undefined && now - last < STATE_LOOKUP_INTERVAL_MS) {
    return false;
  }
  lastStateLookupAt.set(sandboxId, now);
  return true;
}

async function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error("timeout")), ms);
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}

export type PreviewProxyObservationInput = Readonly<{
  request: Request;
  /** A clone of the response when its body is to be read; never the one returned. */
  responseForBody: Response | null;
  status: number;
  durationMs: number;
  /** Asks the sandbox what state its container is in. */
  readContainerState: (sandboxId: string) => Promise<string | null>;
}>;

export async function observePreviewProxyResponse(
  input: PreviewProxyObservationInput,
): Promise<void> {
  const kind = previewResponseObservation(input.status, input.durationMs);
  if (!kind) return;
  const url = new URL(input.request.url);
  const route = previewRouteFromHostname(url.hostname);
  const code = input.responseForBody
    ? await readPreviewErrorCode(input.responseForBody)
    : null;

  let containerState: string | null = null;
  if (input.status === 410 && route && claimStateLookup(route.sandboxId)) {
    try {
      containerState =
        (await withTimeout(
          input.readContainerState(route.sandboxId),
          STATE_LOOKUP_TIMEOUT_MS,
        )) ?? "unknown";
    } catch (error) {
      containerState = `lookup-failed:${error instanceof Error ? error.message : "error"}`;
    }
  }

  logPreviewServerEvent("proxy", {
    kind,
    previewId: route?.sandboxId ?? null,
    port: route?.port ?? null,
    method: input.request.method,
    path: url.pathname.slice(0, MAX_PATH_LENGTH),
    status: input.status,
    code,
    durationMs: input.durationMs,
    containerState,
  });
}
