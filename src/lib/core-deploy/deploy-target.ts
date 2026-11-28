/**
 * The Cloudflare identities one Core deploy is allowed to touch.
 *
 * A Core deploy reads its Worker name and resource ids from `wrangler.jsonc`,
 * which is a file anyone can edit or swap (the staging worktree holds a copy of
 * a different config in the same place). The target is a second, deliberate
 * statement of the same identities, kept outside that file, and the deploy
 * refuses unless the source config, the built artifact and the account the
 * credentials name all agree with it exactly.
 */
export type DeployTarget = Readonly<{
  accountId: string;
  workerName: string;
  /** Workers environment a Custom Domain binds to. Core deploys only the top-level Worker. */
  environment: string;
  /** Binding name to `database_id`. */
  d1Databases: Readonly<Record<string, string>>;
  /** Binding name to namespace `id`. */
  kvNamespaces: Readonly<Record<string, string>>;
  /** Binding name to `bucket_name`. */
  r2Buckets: Readonly<Record<string, string>>;
}>;

export type Parsed<T> =
  | Readonly<{ ok: true; value: T }>
  | Readonly<{ ok: false; problems: readonly string[] }>;

const ACCOUNT_ID = /^[0-9a-f]{32}$/;

function stringMap(
  value: unknown,
  field: string,
  problems: string[],
): Record<string, string> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    problems.push(`target.${field} must be an object of binding name to id.`);
    return {};
  }
  const out: Record<string, string> = {};
  for (const [key, entry] of Object.entries(value)) {
    if (typeof entry !== "string" || entry.trim() === "") {
      problems.push(`target.${field}.${key} must be a non-empty string.`);
      continue;
    }
    out[key] = entry;
  }
  return out;
}

export function parseDeployTarget(value: unknown): Parsed<DeployTarget> {
  const problems: string[] = [];
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return { ok: false, problems: ["The deploy target must be a JSON object."] };
  }
  const raw = value as Record<string, unknown>;
  const allowed = new Set([
    "accountId",
    "workerName",
    "environment",
    "d1Databases",
    "kvNamespaces",
    "r2Buckets",
  ]);
  for (const key of Object.keys(raw)) {
    if (!allowed.has(key)) problems.push(`target.${key} is not a known field.`);
  }
  const accountId = raw.accountId;
  if (typeof accountId !== "string" || !ACCOUNT_ID.test(accountId)) {
    problems.push("target.accountId must be a 32-character Cloudflare account id.");
  }
  const workerName = raw.workerName;
  if (typeof workerName !== "string" || workerName.trim() === "") {
    problems.push("target.workerName must be a non-empty string.");
  }
  const environment = raw.environment ?? "production";
  if (environment !== "production") {
    problems.push(
      `target.environment is ${JSON.stringify(environment)}; only "production" is supported. A Core deploy refuses --env and CLOUDFLARE_ENV, so Wrangler always deploys the Worker's production environment, and the storefront domain provider attaches domains there; any other value would bind platform hostnames where nothing is deployed.`,
    );
  }
  const d1Databases = stringMap(raw.d1Databases, "d1Databases", problems);
  const kvNamespaces = stringMap(raw.kvNamespaces, "kvNamespaces", problems);
  const r2Buckets = stringMap(raw.r2Buckets, "r2Buckets", problems);
  if (!d1Databases.DATABASE) {
    problems.push("target.d1Databases.DATABASE is required: the inventory reads storefront domains from it.");
  }
  if (problems.length > 0) return { ok: false, problems };
  return {
    ok: true,
    value: {
      accountId: accountId as string,
      workerName: workerName as string,
      environment: environment as string,
      d1Databases,
      kvNamespaces,
      r2Buckets,
    },
  };
}
