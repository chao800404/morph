import { sanitizePreviewLogLine } from "@/lib/storefront/compiler/bounded-preview-log";
import { logPreviewServerEvent } from "@/lib/storefront/compiler/preview-server-observation";
import { previewRouteFromHostname } from "./preview-proxy-observation";

/**
 * What a preview sandbox's `fetch` actually failed with.
 *
 * The SDK's `proxyToSandbox` catches a rejected `sandbox.fetch` itself, logs
 * only the message and stack of what it caught, and answers an opaque 500.
 * For the transient errors it recognises (a superseded isolate, a lost
 * connection, a reset Durable Object, anything it marks retryable) what it
 * caught is its own wrapper, whose message always says the platform was
 * updating the sandbox runtime; the error that happened is that wrapper's
 * `cause`, and it is never printed. A local CI run has no platform to update,
 * so that message alone cannot say which of those it was.
 *
 * This records the chain of causes of a rejected `fetch`, before the SDK
 * wraps it, and nothing else:
 * - only `name` and `message` of each error, never a stack;
 * - at most `MAX_CAUSE_DEPTH` errors, each field cut to its limit, and each
 *   passed through the preview log's own sanitiser;
 * - the preview id and the path, read the way the proxy observation reads
 *   them, so the host's token is never logged.
 *
 * Observation only: the same request is sent to the same stub, the same
 * response or the same error comes back, and nothing is retried, delayed or
 * changed. Every other property of the namespace and of its stubs is the
 * binding's own, called on the binding itself.
 */

export const MAX_CAUSE_DEPTH = 4;
const MAX_NAME_LENGTH = 80;
const MAX_MESSAGE_LENGTH = 300;
const MAX_PATH_LENGTH = 300;

export type PreviewErrorCause = Readonly<{ name: string; message: string }>;

function bounded(value: unknown, limit: number): string {
  const text = typeof value === "string" ? value : String(value ?? "");
  return sanitizePreviewLogLine(text.slice(0, limit));
}

/** The error and its causes, bounded; `truncated` when the chain went on. */
export function previewErrorCauseChain(error: unknown): {
  chain: PreviewErrorCause[];
  truncated: boolean;
} {
  const chain: PreviewErrorCause[] = [];
  const seen = new Set<unknown>();
  let current: unknown = error;
  while (current !== undefined && current !== null && !seen.has(current)) {
    if (chain.length === MAX_CAUSE_DEPTH) return { chain, truncated: true };
    seen.add(current);
    const isObject =
      typeof current === "object" || typeof current === "function";
    let name: unknown = "";
    let message: unknown = current;
    let cause: unknown;
    if (isObject) {
      try {
        const record = current as {
          name?: unknown;
          message?: unknown;
          cause?: unknown;
        };
        name = record.name;
        message = record.message;
        cause = record.cause;
      } catch {
        // A getter that throws ends the chain here.
      }
    }
    chain.push({
      name: bounded(name, MAX_NAME_LENGTH),
      message: bounded(message, MAX_MESSAGE_LENGTH),
    });
    current = cause;
  }
  return { chain, truncated: false };
}

/** Logs a rejected sandbox `fetch`; never throws. */
function logRejectedFetch(request: unknown, error: unknown): void {
  try {
    let previewId: string | null = null;
    let path: string | null = null;
    let method: string | null = null;
    if (request instanceof Request) {
      const url = new URL(request.url);
      previewId = previewRouteFromHostname(url.hostname)?.sandboxId ?? null;
      path = bounded(url.pathname, MAX_PATH_LENGTH);
      method = request.method;
    }
    const { chain, truncated } = previewErrorCauseChain(error);
    logPreviewServerEvent("proxy-fetch-rejected", {
      previewId,
      method,
      path,
      chain,
      truncated,
    });
  } catch {
    // Observation must never be what fails a request.
  }
}

/**
 * A namespace property, with its methods called on the namespace itself: the
 * binding's methods are native and refuse any other receiver.
 */
function forwarded(target: object, property: string | symbol): unknown {
  const value = Reflect.get(target, property, target);
  return typeof value === "function"
    ? (...args: unknown[]) => Reflect.apply(value, target, args)
    : value;
}

function observedStub(stub: object): object {
  return new Proxy(stub, {
    get(target, property) {
      // Anything but `fetch` is the stub's own value, unwrapped: an RPC
      // property is both callable and awaitable, and a wrapper would be only
      // one of those.
      if (property !== "fetch") return Reflect.get(target, property, target);
      const fetch = Reflect.get(target, property, target);
      if (typeof fetch !== "function") return fetch;
      return async (...args: unknown[]) => {
        try {
          return await Reflect.apply(fetch, target, args);
        } catch (error) {
          logRejectedFetch(args[0], error);
          throw error;
        }
      };
    },
  });
}

const observedNamespaces = new WeakMap<object, object>();

/**
 * The preview's Durable Object namespace, with each stub's `fetch` observed.
 *
 * One wrapper per namespace, so every caller holds the same object. The SDK
 * caches each sandbox's configuration by namespace object; sharing one
 * wrapper keeps that cache working as it did, with no extra configure call.
 */
export function observedPreviewNamespace<T>(namespace: T): T {
  if (
    namespace === null ||
    (typeof namespace !== "object" && typeof namespace !== "function")
  ) {
    return namespace;
  }
  const target = namespace as unknown as object;
  const existing = observedNamespaces.get(target);
  if (existing) return existing as T;
  const observed = new Proxy(target, {
    get(inner, property) {
      if (property !== "get") return forwarded(inner, property);
      const get = Reflect.get(inner, property, inner);
      if (typeof get !== "function") return get;
      return (...args: unknown[]) => {
        const stub: unknown = Reflect.apply(get, inner, args);
        return stub !== null && typeof stub === "object"
          ? observedStub(stub)
          : stub;
      };
    },
  });
  observedNamespaces.set(target, observed);
  return observed as T;
}
