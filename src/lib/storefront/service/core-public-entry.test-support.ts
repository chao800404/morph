import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { Readable } from "node:stream";

import { StorefrontProductionService } from "./storefront-production.service";
import type { PublishedDocument } from "./storefront-content-runtime";
import { ServiceBindingThemeRuntime } from "./theme-runtimes";

/**
 * Morph Core's public entry on loopback, for tests of a built Theme Worker.
 *
 * Only Core ever calls a released Theme Worker, and Core always names the
 * content source (`x-morph-content-origin`) and signs a render context. A
 * test that calls a built Worker directly has no content source, which a
 * Starter that reads content through `@morph/sdk/start` refuses on purpose.
 * Tests that expect a page therefore reach the Worker the way a shopper does:
 * host -> active release -> the released Worker over the production
 * service-binding transport, with `/_morph/content` answered by Core from the
 * release a render context names.
 *
 * Request bodies and response bodies are streamed, so transport behaviour
 * (multipart, byte streaming, deferred loaders) survives the hop.
 */

/** Published templates of one content publication, by template type. */
export type CorePublicEntryRelease = Readonly<
  Record<string, PublishedDocument | null>
>;

export type CorePublicEntryOptions = Readonly<{
  /**
   * Content by publication id. A template a publication does not list is
   * answered as "nothing authored".
   */
  releases?: Readonly<Record<string, CorePublicEntryRelease>>;
  /**
   * Publication ids in the order they go live. Each request's host
   * resolution reads the current one and moves to the next, the way a
   * publish can land mid-render; the last one stays live. Default: the only
   * publication.
   */
  activeOrder?: readonly string[];
}>;

export type CoreEntryBinding = Readonly<{
  fetch(request: Request): Promise<Response>;
}>;

export type CorePublicEntry = Readonly<{
  /** `http://127.0.0.1:<port>`, the origin a shopper (and the Worker's content reads) use. */
  origin: string;
  /** Goes back to the first publication in `activeOrder`. */
  reset(): void;
  /** `<publicationId>:<templateType>` of every content read Core answered. */
  contentReads: string[];
  close(): void;
}>;

const DEFAULT_PUBLICATION = "pub_default";

export async function startCorePublicEntry(
  binding: CoreEntryBinding,
  options: CorePublicEntryOptions = {},
): Promise<CorePublicEntry> {
  const releases = options.releases ?? { [DEFAULT_PUBLICATION]: {} };
  const order = options.activeOrder ?? [Object.keys(releases)[0]!];
  let position = 0;
  const contentReads: string[] = [];
  const service = new StorefrontProductionService({
    runtime: new ServiceBindingThemeRuntime(() => ({ ok: true, binding })),
    renderContextSecret: "core-public-entry-render-context-secret",
    resolverDeps: {
      domainDal: {
        findByHostname: async (hostname: string) => ({
          id: "dom_1",
          storefrontId: "sf_1",
          hostname,
          status: "active",
        }),
      },
      storefrontDalRef: {
        findActive: async () => ({ id: "sf_1", status: "published" }),
      },
      releaseDal: {
        getActive: async () => {
          const publicationId = order[Math.min(position, order.length - 1)]!;
          position += 1;
          return {
            id: `rel_${publicationId}`,
            themeId: "th_1",
            sourceRevisionId: "rev_1",
            themeBuildId: "bld_1",
            contentPublicationId: publicationId,
          };
        },
      },
      buildDal: {
        getBuildById: async () => ({
          id: "bld_1",
          storefrontId: "sf_1",
          themeId: "th_1",
          status: "succeeded",
          artifactPrefix: "themes/th_1/builds/bld_1",
          manifestJson: {
            artifactEntry: "runtime/server/index.js",
            files: [],
            runtime: {
              kind: "cloudflare-worker",
              workerEntry: "runtime/server/index.js",
              clientAssetsDirectory: "runtime/client",
            },
          },
        }),
      },
    } as never,
    contentPorts: {
      getPublishedDocument: async ({ publicationId, templateType }) => {
        contentReads.push(`${publicationId}:${templateType}`);
        return releases[publicationId]?.[templateType] ?? null;
      },
    },
  });

  const server: Server = createServer((req, res) => {
    const { port } = server.address() as AddressInfo;
    const headers = new Headers();
    for (const [name, value] of Object.entries(req.headers)) {
      if (typeof value === "string") headers.set(name, value);
      else if (Array.isArray(value)) {
        for (const item of value) headers.append(name, item);
      }
    }
    const hasBody = req.method !== "GET" && req.method !== "HEAD";
    const request = new Request(`http://127.0.0.1:${port}${req.url ?? "/"}`, {
      method: req.method,
      headers,
      ...(hasBody
        ? {
            body: Readable.toWeb(req) as unknown as ReadableStream,
            duplex: "half",
          }
        : {}),
    } as RequestInit);
    void service
      .handleRequest(request)
      .then(async (response) => {
        res.statusCode = response.status;
        response.headers.forEach((value, name) => {
          // The body below is already decoded and re-framed; set-cookie is
          // written once, below, as separate headers.
          if (
            !/^(content-encoding|content-length|transfer-encoding|set-cookie)$/i.test(
              name,
            )
          )
            res.setHeader(name, value);
        });
        const cookies = response.headers.getSetCookie();
        if (cookies.length > 0) res.setHeader("set-cookie", cookies);
        res.flushHeaders();
        if (!response.body) return res.end();
        const reader = response.body.getReader();
        res.on("close", () => void reader.cancel().catch(() => undefined));
        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          if (!res.write(value)) {
            await new Promise<void>((resolve) => res.once("drain", resolve));
          }
        }
        res.end();
      })
      .catch((error: unknown) => {
        if (!res.headersSent) res.statusCode = 599;
        res.end(String(error));
      });
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address() as AddressInfo;
  return {
    origin: `http://127.0.0.1:${port}`,
    reset: () => {
      position = 0;
    },
    contentReads,
    close: () => {
      server.closeAllConnections();
      server.close();
    },
  };
}
