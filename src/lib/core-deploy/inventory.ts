import {
  CloudflareReadError,
  type InventoryApi,
  type WorkerDomain,
  type Zone,
  type ZoneRoute,
} from "./cloudflare-api";
import { isPreviewHostname } from "../storefront/service/platform-hostnames";
import type { DeployTarget } from "./deploy-target";
import { isInZone, routePatternHostname, type PlatformManifest } from "./platform-manifest";

/**
 * The Worker's hostname bindings, read before and after a Core deploy and
 * compared by exact identity (design 2, "Inventory before and after").
 *
 * Under option B the deploy writes no binding, so this is a check, not a
 * protection: it shows that what was bound before is bound after, to the same
 * Worker, with the same ids — and refuses a deploy it cannot show that for.
 *
 * What is read, in one "paired read":
 * - D1 `storefront_domains` for every undeleted storefront (not only the
 *   oldest, which is what Settings shows): active rows are what must be bound,
 *   pending and failed rows are reported;
 * - every Custom Domain in the account, unfiltered, so a hostname bound to
 *   another Worker is visible rather than filtered out;
 * - every Workers Route in the platform zone, unfiltered, for the same reason;
 * - the zone itself, to check that each platform hostname belongs to it.
 *
 * There is no count rule. A count can hide a dropped binding behind a new
 * one; every expectation is a hostname or pattern with its identity.
 */

export const STOREFRONT_DOMAIN_ROWS_SQL = [
  "SELECT d.id AS id, d.storefront_id AS storefront_id, d.hostname AS hostname,",
  "d.status AS status, d.cloudflare_domain_id AS cloudflare_domain_id, d.updated_at AS updated_at",
  "FROM storefront_domains d JOIN storefronts s ON s.id = d.storefront_id",
  "WHERE d.deleted_at IS NULL AND s.deleted_at IS NULL",
  "ORDER BY d.hostname, d.id",
].join(" ");

export type StorefrontDomainRow = Readonly<{
  id: string;
  storefrontId: string;
  hostname: string;
  status: string;
  cloudflareDomainId: string | null;
  updatedAt: string | null;
}>;

export type InventorySnapshot = Readonly<{
  readAt: string;
  accountId: string;
  zone: Zone;
  storefrontDomains: readonly StorefrontDomainRow[];
  customDomains: readonly WorkerDomain[];
  zoneRoutes: readonly ZoneRoute[];
}>;

function toRow(raw: Record<string, unknown>): StorefrontDomainRow {
  const text = (key: string) => (typeof raw[key] === "string" ? (raw[key] as string) : null);
  const id = text("id");
  const storefrontId = text("storefront_id");
  const hostname = text("hostname");
  const status = text("status");
  if (!id || !storefrontId || !hostname || !status) {
    throw new CloudflareReadError(`D1: a storefront_domains row lacks id, storefront_id, hostname or status (${JSON.stringify(raw)})`);
  }
  return {
    id,
    storefrontId,
    hostname: hostname.toLowerCase(),
    status,
    cloudflareDomainId: text("cloudflare_domain_id"),
    updatedAt: text("updated_at"),
  };
}

export async function readInventory(
  api: InventoryApi,
  target: DeployTarget,
  manifest: PlatformManifest,
  now: () => Date = () => new Date(),
): Promise<InventorySnapshot> {
  const zone = await api.getZone(manifest.zoneId);
  const databaseId = target.d1Databases.DATABASE!;
  const rows = (await api.queryD1(databaseId, STOREFRONT_DOMAIN_ROWS_SQL)).map(toRow);
  const customDomains = await api.listWorkerDomains();
  const zoneRoutes = await api.listZoneRoutes(manifest.zoneId);
  return {
    readAt: now().toISOString(),
    accountId: target.accountId,
    zone,
    storefrontDomains: rows,
    customDomains,
    zoneRoutes,
  };
}

export type DiscrepancyKind =
  | "platform-hostname-outside-zone"
  | "platform-domain-missing"
  | "platform-domain-wrong-owner"
  | "platform-domain-storefront-row"
  | "platform-domain-changed"
  | "storefront-domain-missing"
  | "storefront-domain-wrong-owner"
  | "storefront-domain-id-mismatch"
  | "unknown-domain"
  | "duplicate-domain"
  | "platform-route-missing"
  | "platform-route-wrong-owner"
  | "platform-route-changed"
  | "unknown-route"
  | "storefront-domain-in-preview-namespace"
  | "storefront-domain-changed"
  | "storefront-domain-pending"
  | "binding-removed"
  | "binding-reassigned";

export type Discrepancy = Readonly<{
  kind: DiscrepancyKind;
  /** Kind plus the exact identities involved; equal keys are the same finding. */
  key: string;
  detail: string;
}>;

export type CompareMode = "strict" | "bootstrap";

/** Kinds a bootstrap deploy expects, because platform:ensure has not run yet. */
const BOOTSTRAP_TOLERATED: ReadonlySet<DiscrepancyKind> = new Set([
  "platform-domain-missing",
  "platform-route-missing",
]);

function identity(domain: WorkerDomain): string {
  return `${domain.hostname} id=${domain.id} service=${domain.service} environment=${domain.environment} zone=${domain.zoneId}`;
}

export function compareInventory(input: {
  snapshot: InventorySnapshot;
  target: DeployTarget;
  manifest: PlatformManifest;
  mode: CompareMode;
  /** The pre-deploy snapshot, for the post-deploy check. */
  baseline?: InventorySnapshot;
}): {
  discrepancies: Discrepancy[];
  tolerated: Discrepancy[];
  diagnostics: string[];
  /** Pending rows: a connect in progress, which a single read must not settle. */
  pending: string[];
} {
  const { snapshot, target, manifest } = input;
  const found: Discrepancy[] = [];
  const diagnostics: string[] = [];
  const add = (kind: DiscrepancyKind, subject: string, detail: string) =>
    found.push({ kind, key: `${kind}|${subject}`, detail });

  const ours = (domain: WorkerDomain) =>
    domain.service === target.workerName &&
    domain.environment === target.environment &&
    domain.zoneId === manifest.zoneId;

  const byHostname = new Map<string, WorkerDomain[]>();
  for (const domain of snapshot.customDomains) {
    byHostname.set(domain.hostname, [...(byHostname.get(domain.hostname) ?? []), domain]);
  }
  for (const [hostname, domains] of byHostname) {
    if (domains.length > 1) {
      add("duplicate-domain", `${hostname}|${domains.map((d) => d.id).sort().join(",")}`, `${hostname} has ${domains.length} Custom Domain entries: ${domains.map(identity).join("; ")}`);
    }
  }
  const rowsByHostname = new Map<string, StorefrontDomainRow[]>();
  for (const row of snapshot.storefrontDomains) {
    rowsByHostname.set(row.hostname, [...(rowsByHostname.get(row.hostname) ?? []), row]);
  }

  // Platform Custom Domains.
  const platform = new Set(manifest.customDomains);
  for (const hostname of manifest.customDomains) {
    if (!isInZone(hostname, snapshot.zone.name)) {
      add("platform-hostname-outside-zone", hostname, `${hostname} is not in zone ${snapshot.zone.name} (${snapshot.zone.id})`);
    }
    const rows = rowsByHostname.get(hostname);
    if (rows) {
      add("platform-domain-storefront-row", `${hostname}|${rows.map((r) => r.id).join(",")}`, `${hostname} is a platform hostname and also a storefront domain row (${rows.map((r) => `${r.id} ${r.status}`).join(", ")})`);
    }
    const bound = byHostname.get(hostname) ?? [];
    if (bound.length === 0) {
      add("platform-domain-missing", hostname, `${hostname} has no Custom Domain`);
    } else {
      for (const domain of bound) {
        if (!ours(domain)) {
          add("platform-domain-wrong-owner", identity(domain), `${hostname} is bound elsewhere: ${identity(domain)}`);
        }
      }
    }
    if (input.baseline) {
      const before = input.baseline.customDomains.filter((d) => d.hostname === hostname).map(identity).sort().join(";");
      const after = bound.map(identity).sort().join(";");
      if (before !== "" && before !== after) {
        add("platform-domain-changed", `${hostname}|${before}|${after}`, `${hostname} changed during the deploy: before ${before}, after ${after || "nothing"}`);
      }
    }
  }

  // Storefront Custom Domains, against every undeleted row.
  const pending: string[] = [];
  const previewEnv = manifest.previewNamespace ? { THEME_PREVIEW_HOSTNAME: manifest.previewNamespace } : {};
  for (const row of snapshot.storefrontDomains) {
    if (platform.has(row.hostname)) continue;
    const bound = byHostname.get(row.hostname) ?? [];
    // Routing classifies preview hosts first (the runtime's own predicate), so
    // a storefront domain inside the preview namespace is not served as the
    // storefront, whatever its binding says.
    if (row.status !== "failed" && isPreviewHostname(row.hostname, previewEnv)) {
      add("storefront-domain-in-preview-namespace", `${row.hostname}|${row.id}`, `${row.hostname} (row ${row.id}, ${row.status}) is inside the preview namespace ${manifest.previewNamespace ?? "preview.localhost"}; routing treats it as a preview host`);
    }
    if (row.status === "pending") pending.push(`${row.id}|${row.hostname}`);
    if (row.status === "active" && input.baseline) {
      const before = input.baseline.storefrontDomains.find((r) => r.id === row.id && r.status === "active");
      // A binding gone after the deploy is reported once, as missing, below.
      if (before && bound.length > 0) {
        const ids = (s: InventorySnapshot) =>
          s.customDomains.filter((d) => d.hostname === row.hostname).map(identity).sort().join(";");
        const beforeIds = `${before.cloudflareDomainId}|${ids(input.baseline)}`;
        const afterIds = `${row.cloudflareDomainId}|${ids(snapshot)}`;
        if (beforeIds !== afterIds) {
          add("storefront-domain-changed", `${row.id}|${beforeIds}|${afterIds}`, `${row.hostname} (row ${row.id}) changed during the deploy: before ${beforeIds}, after ${afterIds}`);
        }
      }
    }
    if (row.status === "active") {
      if (bound.length === 0) {
        add("storefront-domain-missing", `${row.hostname}|${row.id}|${row.cloudflareDomainId}`, `${row.hostname} is active in D1 (row ${row.id}, Cloudflare id ${row.cloudflareDomainId ?? "none"}) and has no Custom Domain`);
        continue;
      }
      for (const domain of bound) {
        if (!ours(domain)) {
          add("storefront-domain-wrong-owner", `${row.id}|${identity(domain)}`, `${row.hostname} (row ${row.id}) is bound elsewhere: ${identity(domain)}`);
        } else if (domain.id !== row.cloudflareDomainId) {
          add("storefront-domain-id-mismatch", `${row.id}|${row.cloudflareDomainId}|${domain.id}`, `${row.hostname}: D1 row ${row.id} records Cloudflare id ${row.cloudflareDomainId ?? "none"}, the bound Custom Domain is ${domain.id}. Reconcile it through the storefront lifecycle (Settings), not by hand.`);
        }
      }
    } else {
      diagnostics.push(
        `${row.status} storefront domain ${row.hostname} (row ${row.id}, updated ${row.updatedAt ?? "?"}): ${bound.length > 0 ? `bound as ${bound.map(identity).join("; ")}` : "not bound"}`,
      );
    }
  }

  // Bindings on this Worker that nothing in D1 or the platform config explains.
  for (const domain of snapshot.customDomains) {
    if (domain.service !== target.workerName) continue;
    if (platform.has(domain.hostname)) continue;
    const rows = rowsByHostname.get(domain.hostname) ?? [];
    if (rows.some((row) => row.status === "active" || row.status === "pending")) continue;
    add("unknown-domain", identity(domain), `${identity(domain)} is bound to this Worker, and no active or pending storefront domain or platform hostname names it`);
  }

  // Workers Routes.
  const expectedPatterns = new Set(manifest.routes.map((route) => route.pattern));
  for (const { pattern } of manifest.routes) {
    if (!isInZone(routePatternHostname(pattern), snapshot.zone.name)) {
      add("platform-hostname-outside-zone", pattern, `${pattern} is not in zone ${snapshot.zone.name}`);
    }
    const matches = snapshot.zoneRoutes.filter((route) => route.pattern === pattern);
    if (matches.length === 0) {
      add("platform-route-missing", pattern, `${pattern} has no Workers Route in zone ${snapshot.zone.name}`);
    }
    for (const route of matches) {
      if (route.script !== target.workerName) {
        add("platform-route-wrong-owner", `${pattern}|${route.id}|${route.script}`, `${pattern} (route ${route.id}) runs ${route.script ?? "no Worker"}`);
      }
    }
    if (input.baseline) {
      const ids = (routes: readonly ZoneRoute[]) =>
        routes.filter((route) => route.pattern === pattern).map((route) => `${route.id}:${route.script}`).sort().join(",");
      const before = ids(input.baseline.zoneRoutes);
      const after = ids(snapshot.zoneRoutes);
      if (before !== "" && before !== after) {
        add("platform-route-changed", `${pattern}|${before}|${after}`, `${pattern} changed during the deploy: before ${before}, after ${after || "nothing"}`);
      }
    }
  }
  for (const route of snapshot.zoneRoutes) {
    if (route.script === target.workerName && !expectedPatterns.has(route.pattern)) {
      add("unknown-route", `${route.pattern}|${route.id}`, `Route ${route.pattern} (${route.id}) runs this Worker and is not in the platform config`);
    }
  }

  // The post-deploy check also walks the pre-deploy identities: a binding of
  // this Worker that is gone afterwards is drift even when nothing else names
  // it any more (its D1 row soft-deleted after a 404, say). Bindings that
  // appeared during the deploy are reported.
  if (input.baseline) {
    const activeNow = new Set(snapshot.storefrontDomains.filter((r) => r.status === "active").map((r) => r.hostname));
    for (const before of input.baseline.customDomains) {
      if (!ours(before)) continue;
      // Kept only if the binding with that id (or, failing that, for that
      // hostname) still has this Worker's owner identity: service,
      // environment and zone. Presence alone is not kept: another Worker can
      // hold the same id or hostname now.
      const now =
        snapshot.customDomains.find((d) => d.id === before.id) ??
        (byHostname.get(before.hostname) ?? []).find((d) => ours(d)) ??
        (byHostname.get(before.hostname) ?? [])[0];
      if (now && ours(now)) continue;
      // A platform hostname or an active row is reported above (missing,
      // wrong owner); anything else would go unreported without this.
      if (platform.has(before.hostname) || activeNow.has(before.hostname)) continue;
      if (!now) {
        add("binding-removed", identity(before), `${identity(before)} was bound to this Worker before the deploy and is gone after it (a Settings disconnect during the deploy also looks like this)`);
      } else {
        add("binding-reassigned", `${identity(before)}|${identity(now)}`, `${before.hostname} was this Worker's before the deploy (${identity(before)}) and is now ${identity(now)}`);
      }
    }
    for (const before of input.baseline.zoneRoutes) {
      if (before.script !== target.workerName) continue;
      const now =
        snapshot.zoneRoutes.find((r) => r.id === before.id) ??
        snapshot.zoneRoutes.find((r) => r.pattern === before.pattern && r.script === target.workerName) ??
        snapshot.zoneRoutes.find((r) => r.pattern === before.pattern);
      if (now && now.script === target.workerName) continue;
      if (expectedPatterns.has(before.pattern)) continue; // reported above (missing, wrong owner)
      if (!now) {
        add("binding-removed", `route|${before.pattern}|${before.id}`, `Route ${before.pattern} (${before.id}) ran this Worker before the deploy and is gone after it`);
      } else {
        add("binding-reassigned", `route|${before.pattern}|${before.id}|${now.id}|${now.script}`, `Route ${before.pattern} ran this Worker before the deploy and now runs ${now.script ?? "no Worker"} (${now.id})`);
      }
    }
    const beforeDomainIds = new Set(input.baseline.customDomains.map((d) => d.id));
    for (const domain of snapshot.customDomains) {
      if (domain.service === target.workerName && !beforeDomainIds.has(domain.id)) {
        diagnostics.push(`added during the deploy: ${domain.hostname} (${domain.id})`);
      }
    }
    const beforeRouteIds = new Set(input.baseline.zoneRoutes.map((r) => r.id));
    for (const route of snapshot.zoneRoutes) {
      if (route.script === target.workerName && !beforeRouteIds.has(route.id)) {
        diagnostics.push(`added during the deploy: Route ${route.pattern} (${route.id})`);
      }
    }
  }

  const tolerated = input.mode === "bootstrap" ? found.filter((d) => BOOTSTRAP_TOLERATED.has(d.kind)) : [];
  const discrepancies = found.filter((d) => !tolerated.includes(d));
  return { discrepancies, tolerated, diagnostics, pending };
}

export type Verdict =
  | Readonly<{ status: "ok"; snapshot: InventorySnapshot; tolerated: Discrepancy[]; diagnostics: string[]; reads: number }>
  | Readonly<{
      status: "drift";
      snapshot: InventorySnapshot;
      /** Found the same in the last two paired reads. */
      drift: Discrepancy[];
      /** Seen in only one of the last two reads: a connect or disconnect still moving. */
      transient: Discrepancy[];
      tolerated: Discrepancy[];
      diagnostics: string[];
      reads: number;
    }>
  | Readonly<{
      status: "transient";
      snapshot: InventorySnapshot;
      transient: Discrepancy[];
      tolerated: Discrepancy[];
      diagnostics: string[];
      reads: number;
    }>
  | Readonly<{ status: "unavailable"; reason: string; reads: number }>;

/**
 * Paired reads until the answer settles.
 *
 * A discrepancy on one read may be a connect or disconnect in progress
 * (connect writes `pending`, attaches, then activates; disconnect detaches
 * while the row is still `active`), so a first read with discrepancies is
 * always followed by a second. Findings present in both of the last two reads
 * are stable drift; findings in only one are transient. Reading stops when a
 * read is clean, when two consecutive reads agree, or after `maxReads`.
 *
 * A read that fails is `unavailable`, never "nothing found".
 */
export async function reconcile(input: {
  read: () => Promise<InventorySnapshot>;
  compare: (snapshot: InventorySnapshot) => ReturnType<typeof compareInventory>;
  maxReads?: number;
  delayMs?: number;
  sleep?: (ms: number) => Promise<void>;
}): Promise<Verdict> {
  const maxReads = Math.max(2, input.maxReads ?? 4);
  const delayMs = input.delayMs ?? 3000;
  const sleep = input.sleep ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)));
  let previous: Discrepancy[] | null = null;
  let previousPending: string[] | null = null;
  for (let reads = 1; reads <= maxReads; reads += 1) {
    let snapshot: InventorySnapshot;
    try {
      snapshot = await input.read();
    } catch (error) {
      return {
        status: "unavailable",
        reason: error instanceof Error ? error.message : String(error),
        reads,
      };
    }
    const { discrepancies, tolerated, diagnostics, pending } = input.compare(snapshot);
    if (discrepancies.length === 0) {
      // A pending row is a connect in progress: its row may activate, or its
      // binding appear, between two reads. One read does not settle it, so a
      // clean first read with pending rows is read once more; rows still
      // pending after that are reported, not compared (an abandoned connect
      // must not block every later deploy).
      // Read again while a pending row is one the previous read did not have:
      // every pending row is seen on two consecutive paired reads.
      const unseen = pending.filter((key) => !(previousPending ?? []).includes(key));
      if (unseen.length > 0) {
        if (reads === maxReads) {
          // A connect that started on the last allowed read is still moving.
          return {
            status: "transient",
            snapshot,
            transient: unseen.map((key) => ({
              kind: "storefront-domain-pending" as const,
              key: `storefront-domain-pending|${key}`,
              detail: `pending storefront domain ${key} first seen on the last paired read`,
            })),
            tolerated,
            diagnostics,
            reads,
          };
        }
        previousPending = pending;
        previous = [];
        await sleep(delayMs);
        continue;
      }
      const stillPending = previousPending ? pending.filter((key) => previousPending!.includes(key)) : pending;
      return {
        status: "ok",
        snapshot,
        tolerated,
        diagnostics: [
          ...diagnostics,
          ...(stillPending.length > 0 ? [`${stillPending.length} pending row(s) unchanged across ${reads} paired read(s): ${stillPending.join(", ")}`] : []),
        ],
        reads,
      };
    }
    // Compared with the immediately preceding read only.
    previousPending = pending;
    if (previous) {
      const before = new Set(previous.map((d) => d.key));
      const now = new Set(discrepancies.map((d) => d.key));
      const stable = discrepancies.filter((d) => before.has(d.key));
      const moving = [
        ...discrepancies.filter((d) => !before.has(d.key)),
        ...previous.filter((d) => !now.has(d.key)),
      ];
      if (moving.length === 0 || reads === maxReads) {
        return stable.length > 0
          ? { status: "drift", snapshot, drift: stable, transient: moving, tolerated, diagnostics, reads }
          : { status: "transient", snapshot, transient: moving, tolerated, diagnostics, reads };
      }
    }
    previous = discrepancies;
    await sleep(delayMs);
  }
  // Unreachable: the loop returns on its last read.
  return { status: "unavailable", reason: "no read completed", reads: maxReads };
}

export function describeVerdict(verdict: Verdict): string[] {
  const lines: string[] = [];
  if (verdict.status === "unavailable") {
    return [`verification unavailable after ${verdict.reads} read(s): ${verdict.reason}`];
  }
  lines.push(`${verdict.status} after ${verdict.reads} paired read(s)`);
  if (verdict.status === "drift") for (const d of verdict.drift) lines.push(`  drift: ${d.detail}`);
  if (verdict.status === "drift" || verdict.status === "transient") {
    for (const d of verdict.transient) lines.push(`  transient: ${d.detail}`);
  }
  for (const d of verdict.tolerated) lines.push(`  bootstrap pending: ${d.detail}`);
  for (const line of verdict.diagnostics) lines.push(`  note: ${line}`);
  return lines;
}

/** The identities a run should record, without anything else from the read. */
export function bindingIdentities(snapshot: InventorySnapshot, workerName: string) {
  return {
    readAt: snapshot.readAt,
    zone: snapshot.zone,
    customDomains: snapshot.customDomains
      .filter((d) => d.service === workerName)
      .map((d) => ({ hostname: d.hostname, id: d.id, environment: d.environment, zoneId: d.zoneId })),
    zoneRoutes: snapshot.zoneRoutes
      .filter((r) => r.script === workerName)
      .map((r) => ({ pattern: r.pattern, id: r.id })),
    storefrontDomains: snapshot.storefrontDomains.map((r) => ({
      hostname: r.hostname,
      status: r.status,
      rowId: r.id,
      storefrontId: r.storefrontId,
      cloudflareDomainId: r.cloudflareDomainId,
    })),
  };
}
