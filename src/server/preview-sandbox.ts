import { Sandbox } from "@cloudflare/sandbox";
import { storefrontPreviewAccessDal } from "@/lib/storefront/dal/storefront-preview-access.dal";
import { reverifyPreviewAccessGrant } from "@/lib/storefront/service/preview-access/preview-access";
import { PREVIEW_SOCKET_LEASE_MS } from "@/lib/storefront/service/preview-access/preview-socket-lease";
import {
  PREVIEW_SOCKET_GRANT_HEADER,
  PREVIEW_SOCKET_HOST_HEADER,
  type PreviewSocketRelay,
  type RelaySocket,
  relayPreviewSocket,
  withoutPreviewSocketHeaders,
} from "@/lib/storefront/service/preview-access/preview-socket-relay";
import { refusePreviewEgress } from "@/lib/storefront/service/preview-egress-policy";

/**
 * The Durable Object class Live Preview containers run under.
 *
 * The same SDK and image as the build and deploy containers, bound separately
 * so that each use has a policy of its own. A preview runs Theme code for as
 * long as someone is editing, so it starts with no internet
 * (`enableInternet = false`, part of the container's start configuration, so
 * there is no moment it runs with more), and its HTTP and HTTPS requests go
 * to `refusePreviewEgress`, which refuses them all. `interceptHttps` puts a CA
 * of the container's own into it, so an HTTPS request reaches the refusal
 * rather than failing its handshake.
 *
 * The SDK applies this interception before every container start, a restart
 * included; see `ContainerProxy` in the Worker entry, without which none of
 * it takes effect.
 *
 * WebSockets from a `pv-` host (#214 P4, addendum A5/A6): the Worker marks a
 * verified upgrade with its grant. The SDK still makes the container socket
 * exactly as before, its inflight and activity bookkeeping included; this
 * class relays that socket to the browser under the grant's lease, keeps
 * which grants it relays, and closes them on a pushed revocation. An upgrade
 * without a grant (the dev-only SDK passthrough) is the SDK's, unchanged.
 */
export class PreviewSandbox extends Sandbox {
  enableInternet = false;
  interceptHttps = true;

  /** The relayed sockets, by the grant each was opened with. */
  private readonly previewSockets = new Map<string, Set<PreviewSocketRelay>>();
  /**
   * Grants revoked by a push, kept 2·L (A6): a socket registered after its
   * grant's notice is refused, whatever its handshake saw.
   */
  private readonly previewRevoked = new Map<string, number>();

  override async fetch(request: Request): Promise<Response> {
    const grantId = request.headers.get(PREVIEW_SOCKET_GRANT_HEADER);
    const previewHost = request.headers.get(PREVIEW_SOCKET_HOST_HEADER);
    const forwarded = withoutPreviewSocketHeaders(request);
    if (
      request.headers.get("upgrade")?.toLowerCase() !== "websocket" ||
      grantId === null
    ) {
      return super.fetch(forwarded);
    }
    if (!previewHost) return refused(403);
    this.pruneRevoked();
    if (this.previewRevoked.has(grantId)) return refused(403);

    const response = await super.fetch(forwarded);
    const container = response.webSocket;
    if (response.status !== 101 || !container) return response;
    if (this.previewRevoked.has(grantId)) {
      container.accept();
      container.close(1000, "Preview access ended.");
      return refused(403);
    }
    container.accept();
    const [client, server] = Object.values(new WebSocketPair()) as [
      WebSocket,
      WebSocket,
    ];
    server.accept();

    const sockets = this.previewSockets.get(grantId) ?? new Set();
    this.previewSockets.set(grantId, sockets);
    const relay = relayPreviewSocket({
      browser: server as unknown as RelaySocket,
      container: container as unknown as RelaySocket,
      now: () => Date.now(),
      verify: async () => {
        // Throws on a D1 error: the lease reads that as "unavailable".
        const result = await reverifyPreviewAccessGrant({
          dal: storefrontPreviewAccessDal,
          grantId,
          previewHost,
        });
        return result.ok ? "valid" : "revoked";
      },
      onEnd: () => {
        sockets.delete(relay);
        if (sockets.size === 0) this.previewSockets.delete(grantId);
      },
    });
    if (!relay.closed) sockets.add(relay);
    return new Response(null, {
      status: 101,
      headers: response.headers,
      webSocket: client,
    });
  }

  /**
   * A pushed revocation (A6): closes every socket relayed for these grants
   * with 4401 and refuses new ones for 2·L. Best effort by design; the lease
   * bounds a socket whose notice never arrives. Returns how many closed.
   */
  async closePreviewGrants(grantIds: readonly string[]): Promise<number> {
    const now = Date.now();
    let closed = 0;
    for (const grantId of grantIds) {
      this.previewRevoked.set(grantId, now);
      for (const relay of [...(this.previewSockets.get(grantId) ?? [])]) {
        relay.notice();
        closed += 1;
      }
    }
    this.pruneRevoked(now);
    return closed;
  }

  private pruneRevoked(now = Date.now()) {
    for (const [grantId, at] of this.previewRevoked) {
      if (now - at > 2 * PREVIEW_SOCKET_LEASE_MS) {
        this.previewRevoked.delete(grantId);
      }
    }
  }
}

function refused(status: number): Response {
  return new Response("Preview access required.", {
    status,
    headers: {
      "Content-Type": "text/plain; charset=utf-8",
      "Cache-Control": "private, no-store",
    },
  });
}

// Assigned, not declared as `static outbound = …`: the handler is registered
// by the inherited static setter, which a class field would bypass by
// defining a property of its own, leaving the container with no handler.
PreviewSandbox.outbound = (request, _env, ctx) =>
  refusePreviewEgress(request, ctx.containerId);
