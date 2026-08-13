export interface ProvisionDomainDependencies {
  attach: (hostname: string) => Promise<string | null>;
  detach: (domainId: string) => Promise<void>;
  activate: (cloudflareDomainId: string | null) => Promise<void>;
  markFailed: (message: string) => Promise<void>;
}

export const provisionStorefrontDomain = async (
  hostname: string,
  dependencies: ProvisionDomainDependencies,
) => {
  let cloudflareDomainId: string | null = null;
  try {
    cloudflareDomainId = await dependencies.attach(hostname);
    await dependencies.activate(cloudflareDomainId);
  } catch (error) {
    if (cloudflareDomainId) {
      try {
        await dependencies.detach(cloudflareDomainId);
      } catch (compensationError) {
        await dependencies.markFailed(
          "Cloudflare provisioning failed and cleanup must be retried",
        );
        throw new AggregateError(
          [error, compensationError],
          "Domain provisioning and compensation failed",
        );
      }
    }
    await dependencies.markFailed(
      error instanceof Error ? error.message : "Domain provisioning failed",
    );
    throw error;
  }
  return cloudflareDomainId;
};
