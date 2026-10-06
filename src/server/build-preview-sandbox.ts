import { Sandbox } from "@cloudflare/sandbox";
import { storefrontBuildPreviewCapabilityDal } from "@/lib/storefront/dal/storefront-build-preview-capability.dal";
import { storefrontContentPublicationDal } from "@/lib/storefront/dal/storefront-content-publication.dal";
import { answerBuildPreviewEgress } from "@/lib/storefront/service/build-preview/build-preview-egress";
import { buildPreviewSandboxName } from "@/lib/storefront/service/build-preview/cloudflare-sandbox-build-preview-server";

/**
 * The Durable Object class Build Preview containers run under.
 *
 * Its own class, as `PreviewSandbox` is the Live Preview's: same image, a
 * policy of its own. No internet from the first moment
 * (`enableInternet = false`), HTTPS intercepted so a request reaches the
 * policy rather than failing its handshake, and every request handed to
 * `answerBuildPreviewEgress`, which answers only this container's own
 * `/_morph/content` and refuses everything else.
 */
export class BuildPreviewSandbox extends Sandbox {
  enableInternet = false;
  interceptHttps = true;
}

type Namespace = { idFromName(name: string): { toString(): string } };

// Assigned, not declared as `static outbound = …`: see preview-sandbox.ts.
BuildPreviewSandbox.outbound = (request, env, ctx) => {
  const bindings = env as unknown as Record<string, unknown>;
  const namespace = bindings.BuildPreviewSandbox as Namespace;
  return answerBuildPreviewEgress(request, ctx.containerId, {
    env: bindings,
    capabilityDal: storefrontBuildPreviewCapabilityDal,
    contentPorts: {
      getPublishedDocument: (args) =>
        storefrontContentPublicationDal.getPublishedTemplateDocument(
          args,
        ) as never,
      getPublishedPageDocument: (args) =>
        storefrontContentPublicationDal.getPublishedPageDocument(args) as never,
      getPublishedRouteDocument: (args) =>
        storefrontContentPublicationDal.getPublishedRouteDocument(
          args,
        ) as never,
    },
    containerIdFor: (capabilityId) =>
      namespace.idFromName(buildPreviewSandboxName(capabilityId)).toString(),
  });
};
