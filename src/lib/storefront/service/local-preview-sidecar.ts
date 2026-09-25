import {
  createServer as createHttpServer,
  type IncomingMessage,
  type ServerResponse,
} from "node:http";
import {
  LocalPreviewStagingError,
  LocalVitePreviewServer,
} from "@/lib/storefront/compiler/local-vite-preview-server";
import { readLocalPreviewOrigin } from "@/lib/storefront/compiler/local-preview-host";
import {
  LOCAL_PREVIEW_SIDECAR_DIGEST_HEADER,
  LOCAL_PREVIEW_SIDECAR_MAX_BINARY_BYTES,
  LOCAL_PREVIEW_SIDECAR_MAX_BODY_BYTES,
  LOCAL_PREVIEW_SIDECAR_PATHS,
  LOCAL_PREVIEW_SIDECAR_PREVIEW_ID_HEADER,
  LOCAL_PREVIEW_SIDECAR_SIZE_HEADER,
  LOCAL_PREVIEW_SIDECAR_TOKEN_HEADER,
  localPreviewTokenMatches,
  readLocalPreviewSidecarToken,
  type LocalPreviewSidecarOperation,
} from "./local-preview-sidecar.protocol";
import { isProductionEnvironment } from "./storefront-domain-provider";

/**
 * The Node process a locally-run Live Preview is served from.
 *
 * This is, precisely, a remote-code-execution primitive: it accepts a file
 * layout and runs a dev server over it, which executes whatever JavaScript the
 * layout contains. It is the same primitive the sandbox container is, moved out
 * of a container and onto the machine the developer is working on, and that
 * difference is why it is fenced in code rather than by how it is started.
 *
 * Four fences, all of them refusals rather than conventions:
 *
 * 1. **Loopback, never a routable address.** The origin it is given must name
 *    this machine, and it binds `127.0.0.1` explicitly. A sidecar on `0.0.0.0`
 *    would put an unauthenticated Theme executor on the local network.
 * 2. **It cannot start in a production runtime**, judged by the same
 *    `isProductionEnvironment` signal the rest of the app uses.
 * 3. **A per-process token**, required on every request and compared in constant
 *    time. Nothing that has not been handed the secret out of band can drive it.
 * 4. **It is not in the deploy artifact.** `scripts/check-local-preview-sidecar.mjs`
 *    fails the build if this module's markers appear under `dist/`, so it cannot
 *    quietly become reachable from the Worker through an import.
 *
 * What it is not: a fourth implementation of anything. It routes to
 * `LocalVitePreviewServer` and does no Theme work of its own. Every path here is
 * one member of `ThemePreviewServer`, plus the file application the sandbox path
 * gets from the container binding instead.
 *
 * `scripts/theme-preview-sidecar.mjs` is what runs this, because a Worker cannot:
 * `node:fs` there is an in-memory file system scoped to one request, so there is
 * nowhere for a workspace to live and nothing for a dev server to watch.
 */

export type LocalPreviewSidecarOptions = Readonly<{
  /** Loopback origin to listen on, for example `http://127.0.0.1:5199`. */
  origin: string;
  /** Token every request must present. The same value the Worker reads. */
  token: string | undefined;
  /** Where Theme workspaces are laid out. */
  workspacesRoot?: string;
  /** Root the pinned toolchain resolves from. */
  toolchainRoot?: string;
  /** Theme dependency allowlist, so local and deployed agree on it. */
  approvedDependencies?: readonly string[];
  /** Environment the production refusal is judged on. */
  env?: Record<string, unknown>;
}>;

export type LocalPreviewSidecar = Readonly<{
  /** The origin it is actually listening on. */
  origin: string;
  close(): Promise<void>;
}>;

async function readBody(
  request: IncomingMessage,
  limit: number,
): Promise<{ ok: true; bytes: Buffer } | { ok: false; reason: string }> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of request) {
    const buffer = chunk as Buffer;
    size += buffer.byteLength;
    if (size > limit) {
      return {
        ok: false,
        reason: `LOCAL_PREVIEW_SIDECAR_BODY_TOO_LARGE: over ${limit} bytes.`,
      };
    }
    chunks.push(buffer);
  }
  return { ok: true, bytes: Buffer.concat(chunks) };
}

function respond(response: ServerResponse, status: number, body: unknown): void {
  const payload = JSON.stringify(body ?? {});
  response.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store",
    "content-length": Buffer.byteLength(payload),
  });
  response.end(payload);
}

function headerValue(value: string | string[] | undefined): string | undefined {
  if (Array.isArray(value)) return value[0];
  return value;
}

/**
 * Starts the sidecar, or refuses to.
 *
 * Everything that makes this safe to leave running on a developer's machine is
 * checked here, before a socket exists: the runtime is not production, the
 * address is loopback on an explicit port, and there is a token to require.
 * None of the three can be waived by a caller.
 */
export async function startLocalPreviewSidecar(
  options: LocalPreviewSidecarOptions,
): Promise<LocalPreviewSidecar> {
  const env = options.env ?? (process.env as Record<string, unknown>);

  if (isProductionEnvironment(env)) {
    throw new Error(
      "LOCAL_PREVIEW_SIDECAR_REFUSED: A local preview sidecar executes Theme code and must never run in a production runtime.",
    );
  }

  const origin = readLocalPreviewOrigin(options.origin);
  if (!origin.ok) throw new Error(origin.reason);

  const token = readLocalPreviewSidecarToken(options.token);
  if (!token.ok) throw new Error(token.reason);

  const previews = new LocalVitePreviewServer({
    workspacesRoot: options.workspacesRoot,
    toolchainRoot: options.toolchainRoot,
    approvedDependencies: options.approvedDependencies,
  });

  const handle = async (
    operation: LocalPreviewSidecarOperation,
    request: IncomingMessage,
    response: ServerResponse,
  ): Promise<void> => {
    const presented = headerValue(
      request.headers[LOCAL_PREVIEW_SIDECAR_TOKEN_HEADER],
    );
    if (!localPreviewTokenMatches(token.token, presented)) {
      // No detail, and no difference between a wrong token and a missing one:
      // the only caller that could tell them apart is one that already has it.
      respond(response, 401, { error: "LOCAL_PREVIEW_SIDECAR_UNAUTHORIZED" });
      return;
    }
    if (request.method !== "POST") {
      respond(response, 405, { error: "LOCAL_PREVIEW_SIDECAR_METHOD" });
      return;
    }

    // Bytes, not JSON, and one file's worth at most.
    if (operation === "stageBinary") {
      const staged = await readBody(
        request,
        LOCAL_PREVIEW_SIDECAR_MAX_BINARY_BYTES,
      );
      if (!staged.ok) {
        respond(response, 413, { error: staged.reason });
        return;
      }
      try {
        respond(
          response,
          200,
          await previews.stageBinary({
            previewId:
              headerValue(
                request.headers[LOCAL_PREVIEW_SIDECAR_PREVIEW_ID_HEADER],
              ) ?? "",
            digest:
              headerValue(request.headers[LOCAL_PREVIEW_SIDECAR_DIGEST_HEADER]) ??
              "",
            sizeBytes: Number(
              headerValue(request.headers[LOCAL_PREVIEW_SIDECAR_SIZE_HEADER]),
            ),
            bytes: new Uint8Array(
              staged.bytes.buffer,
              staged.bytes.byteOffset,
              staged.bytes.byteLength,
            ),
          }),
        );
      } catch (error) {
        if (error instanceof LocalPreviewStagingError) {
          respond(response, 400, { error: error.message });
          return;
        }
        throw error;
      }
      return;
    }

    const body = await readBody(request, LOCAL_PREVIEW_SIDECAR_MAX_BODY_BYTES);
    if (!body.ok) {
      respond(response, 413, { error: body.reason });
      return;
    }
    let input: unknown;
    try {
      input = JSON.parse(body.bytes.toString("utf8"));
    } catch {
      respond(response, 400, { error: "LOCAL_PREVIEW_SIDECAR_BAD_JSON" });
      return;
    }

    switch (operation) {
      case "start":
        respond(
          response,
          200,
          await previews.start(
            input as Parameters<LocalVitePreviewServer["start"]>[0],
          ),
        );
        return;
      case "isServing":
        respond(response, 200, {
          serving: await previews.isServing(
            input as Parameters<LocalVitePreviewServer["isServing"]>[0],
          ),
        });
        return;
      case "stop": {
        const stopInput = input as { previewId: string; processId?: string };
        await previews.stop(stopInput.previewId, stopInput.processId);
        respond(response, 200, {});
        return;
      }
      case "applyFiles": {
        const applyInput = input as {
          previewId: string;
          files: readonly { path: string; content: string; fence: number }[];
        };
        respond(
          response,
          200,
          await previews.writeFiles(applyInput.previewId, applyInput.files),
        );
        return;
      }
    }
  };

  const server = createHttpServer((request, response) => {
    const pathname = (request.url ?? "/").split("?")[0] ?? "/";
    const operation = (
      Object.keys(LOCAL_PREVIEW_SIDECAR_PATHS) as LocalPreviewSidecarOperation[]
    ).find((candidate) => LOCAL_PREVIEW_SIDECAR_PATHS[candidate] === pathname);
    if (!operation) {
      respond(response, 404, { error: "LOCAL_PREVIEW_SIDECAR_NOT_FOUND" });
      return;
    }
    void handle(operation, request, response).catch((error: unknown) => {
      respond(response, 500, {
        error:
          error instanceof Error ? error.message : "LOCAL_PREVIEW_SIDECAR_FAILED",
      });
    });
  });

  await new Promise<void>((resolve, reject) => {
    const onError = (error: unknown) => reject(error);
    server.once("error", onError);
    // Loopback explicitly, not by omission: `listen(port)` alone would accept
    // connections on every interface this machine has.
    server.listen(origin.port, "127.0.0.1", () => {
      server.off("error", onError);
      resolve();
    });
  });

  return {
    origin: `http://127.0.0.1:${origin.port}`,
    async close() {
      for (const previewId of previews.servingPreviewIds()) {
        await previews.stop(previewId).catch(() => undefined);
      }
      const closed = new Promise<void>((resolve) =>
        server.close(() => resolve()),
      );
      server.closeAllConnections();
      await closed;
    },
  };
}
