import { Sandbox } from "@cloudflare/sandbox";
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
 */
export class PreviewSandbox extends Sandbox {
  enableInternet = false;
  interceptHttps = true;
}

// Assigned, not declared as `static outbound = …`: the handler is registered
// by the inherited static setter, which a class field would bypass by
// defining a property of its own, leaving the container with no handler.
PreviewSandbox.outbound = (request, _env, ctx) =>
  refusePreviewEgress(request, ctx.containerId);
