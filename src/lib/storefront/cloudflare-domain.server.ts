import { env } from "cloudflare:workers";

type DomainEnv = typeof env & {
  CLOUDFLARE_API_TOKEN?: string;
  CLOUDFLARE_ACCOUNT_ID?: string;
  CLOUDFLARE_ZONE_ID?: string;
  CLOUDFLARE_WORKER_SERVICE?: string;
};

const configuration = () => {
  const values = env as DomainEnv;
  const token = values.CLOUDFLARE_API_TOKEN;
  const accountId = values.CLOUDFLARE_ACCOUNT_ID;
  const zoneId = values.CLOUDFLARE_ZONE_ID;
  const service = values.CLOUDFLARE_WORKER_SERVICE;
  if (!token || !accountId || !zoneId || !service) {
    throw new Error("Cloudflare domain management is not configured");
  }
  return { token, accountId, zoneId, service };
};

const request = async (
  url: string,
  init: RequestInit,
  options: { allowNotFound?: boolean } = {},
) => {
  const { token } = configuration();
  const response = await fetch(url, {
    ...init,
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
  });
  const payload = (await response.json()) as {
    success?: boolean;
    result?: { id?: string };
    errors?: Array<{ message?: string }>;
  };
  if (options.allowNotFound && response.status === 404) return undefined;
  if (!response.ok || !payload.success) {
    throw new Error(
      payload.errors?.[0]?.message ?? "Cloudflare rejected the domain request",
    );
  }
  return payload.result;
};

export const cloudflareDomainProvider = {
  async attach(hostname: string): Promise<string | null> {
    const { accountId, zoneId, service } = configuration();
    const result = await request(
      `https://api.cloudflare.com/client/v4/accounts/${accountId}/workers/domains`,
      {
        method: "PUT",
        body: JSON.stringify({ hostname, service, zone_id: zoneId }),
      },
    );
    return result?.id ?? null;
  },
  async detach(domainId: string): Promise<void> {
    const { accountId } = configuration();
    await request(
      `https://api.cloudflare.com/client/v4/accounts/${accountId}/workers/domains/${domainId}`,
      { method: "DELETE" },
      { allowNotFound: true },
    );
  },
};
