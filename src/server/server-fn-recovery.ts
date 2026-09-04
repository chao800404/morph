/** Where TanStack Start posts server functions. */
export const SERVER_FN_PATH_PREFIX = "/_serverFn/";

/** Marks a response this module produced, so it is greppable in a log. */
export const STALE_SERVER_FN_HEADER = "x-morph-serverfn-unresolved";

export function isServerFnRequest(request: Request): boolean {
  try {
    return new URL(request.url).pathname.startsWith(SERVER_FN_PATH_PREFIX);
  } catch {
    return false;
  }
}

/**
 * Turns a server function id into something readable in a log.
 *
 * The id is base64 of `{file, export}`, so printed raw it is a wall of
 * characters that has to be decoded by hand before it says which function
 * failed — which is the first thing anyone reading the line needs.
 */
export function describeServerFnId(id: string | undefined): string {
  if (!id) return "unknown";
  try {
    const { file, export: exported } = JSON.parse(atob(id)) as {
      file?: string;
      export?: string;
    };
    if (!file || !exported) return id;
    const name = exported.replace(/_createServerFn_handler$/, "");
    return `${name} (${file.split("?")[0]})`;
  } catch {
    return id;
  }
}

/** The id the request was addressed to, for the log line and the body. */
export function serverFnIdFromRequest(request: Request): string | undefined {
  try {
    const { pathname } = new URL(request.url);
    if (!pathname.startsWith(SERVER_FN_PATH_PREFIX)) return undefined;
    return pathname.slice(SERVER_FN_PATH_PREFIX.length) || undefined;
  } catch {
    return undefined;
  }
}

/**
 * Whether a body is h3's catch-all for an exception that escaped the handler.
 *
 * h3 does not throw this outward — it returns it — so it has to be recognised
 * on the response rather than caught. The shape is exact and carries nothing
 * else, which is the whole problem: `{"status":500,"unhandled":true,
 * "message":"HTTPError"}` names no cause, so every failure that reaches it
 * looks identical.
 */
export function isOpaqueUnhandledBody(body: string): boolean {
  if (body.length > 200) return false;
  try {
    const parsed = JSON.parse(body) as Record<string, unknown>;
    return (
      parsed.unhandled === true &&
      parsed.status === 500 &&
      parsed.message === "HTTPError"
    );
  } catch {
    return false;
  }
}

/**
 * Replaces h3's blank 500 on a server function with something actionable.
 *
 * Deliberately does not claim the id was stale. A stale id is the common cause
 * (TanStack/router#7363: Start throws out of `getServerFnById` instead of
 * answering 404), but a genuine crash inside a handler lands in the same
 * catch-all, and labelling those "not found" would send people to debug the
 * wrong thing. This says what is actually known — the call produced no reason —
 * names the id, and points at the two places the reason can be.
 *
 * The status stays 500. A handler that really did crash did fail on the server,
 * and rewriting that to 404 would be a second lie in place of the first.
 *
 * Not an auto-reload: a stale id is repaired by a full page load, but this is
 * an editor holding unsaved workspace edits in memory, and reloading it out
 * from under someone to work around a dev-server artifact costs more than the
 * error does.
 */
export function describeOpaqueServerFnFailure(options: {
  dev: boolean;
  functionId?: string;
}): Response {
  const message = options.dev
    ? "This server function returned no reason. The cause is printed in the dev server terminal. If it started after an edit, reload the page first — the browser can hold a server function id this build no longer has."
    : "This server function failed without reporting a reason. The cause is in the server logs.";

  return new Response(
    JSON.stringify({
      success: false,
      error: "SERVER_FN_UNHANDLED",
      message,
      functionId: options.functionId,
    }),
    {
      status: 500,
      headers: {
        "Content-Type": "application/json",
        [STALE_SERVER_FN_HEADER]: "1",
        "Cache-Control": "no-store",
      },
    },
  );
}

/**
 * Passes a response through, unless it is the blank 500 for a server function.
 *
 * The body is only read for a 500 on a server function route, and from a clone,
 * so no other response is buffered or consumed on its way out.
 */
export async function recoverServerFnResponse(
  request: Request,
  response: Response,
  options: { dev: boolean },
): Promise<Response> {
  if (response.status !== 500) return response;
  if (!isServerFnRequest(request)) return response;

  let body: string;
  try {
    body = await response.clone().text();
  } catch {
    return response;
  }
  if (!isOpaqueUnhandledBody(body)) return response;

  const functionId = serverFnIdFromRequest(request);
  console.error(
    `Server function failed with no reported reason: ${describeServerFnId(functionId)}`,
  );
  return describeOpaqueServerFnFailure({ dev: options.dev, functionId });
}
