import {
  CloudflareWriteError,
  type BootstrapApi,
  type WorkerDomain,
  type ZoneRoute,
} from "./cloudflare-api";
import type { DeployTarget } from "./deploy-target";
import type { InventorySnapshot } from "./inventory";
import { isInZone, routePatternHostname, type PlatformManifest } from "./platform-manifest";

/**
 * `platform:ensure` — binds Morph Core's own hostnames to its Worker, once,
 * outside an ordinary deploy (design 2, "Bootstrap and repair").
 *
 * Contract:
 * - **Create-only.** It never deletes, never moves a binding, and never
 *   adopts one: a hostname bound to another Worker, or one a storefront
 *   domain row names (even on this Worker), is refused, and nothing at all is
 *   written in a run that finds a refusal.
 * - **Resumable.** Each run reads the current state and creates only what is
 *   missing, so a run that stopped part-way is finished by running it again.
 *   It stops at the first failed write.
 * - **Re-reads after every write.** The Custom Domain attach is a PUT: an
 *   empty read followed by a PUT does not prove the PUT created anything, so
 *   each one is followed by a fresh read that must show exactly one binding
 *   for the hostname, on this Worker. An error that may have been applied is
 *   resolved the same way. A Route create that fails is re-read too: a
 *   matching Route on this Worker is accepted, anything else is a failure.
 *
 * What it cannot fence is another writer racing it between the read and the
 * PUT. The ownership assumption is stated instead: platform hostnames are
 * bound by this command only. The runtime refuses them as storefront domains
 * (`isReservedPlatformHostname`), so Settings cannot claim one; an operator
 * binding one by hand is outside the contract.
 *
 * Wildcard DNS, TLS and HTTP reachability of the preview Route are not proven
 * by a Route existing; they are verified separately (DEPLOY.md).
 */

export type EnsureStep = Readonly<{
  kind: "custom-domain" | "route";
  subject: string;
  outcome: "present" | "created" | "refused" | "failed" | "not-attempted";
  detail: string;
}>;

export type EnsureResult = Readonly<{
  status: "complete" | "refused" | "failed";
  steps: EnsureStep[];
}>;

type Plan =
  | { kind: "custom-domain"; hostname: string; action: "present" | "create" | "refuse"; detail: string }
  | { kind: "route"; pattern: string; action: "present" | "create" | "refuse"; detail: string };

function domainIsOurs(domain: WorkerDomain, target: DeployTarget, manifest: PlatformManifest): boolean {
  return (
    domain.service === target.workerName &&
    domain.environment === target.environment &&
    domain.zoneId === manifest.zoneId
  );
}

function plan(snapshot: InventorySnapshot, target: DeployTarget, manifest: PlatformManifest): Plan[] {
  const steps: Plan[] = [];
  for (const hostname of manifest.customDomains) {
    const rows = snapshot.storefrontDomains.filter((row) => row.hostname === hostname);
    const bound = snapshot.customDomains.filter((domain) => domain.hostname === hostname);
    if (!isInZone(hostname, snapshot.zone.name)) {
      steps.push({ kind: "custom-domain", hostname, action: "refuse", detail: `not in zone ${snapshot.zone.name}` });
    } else if (rows.length > 0) {
      steps.push({
        kind: "custom-domain",
        hostname,
        action: "refuse",
        detail: `storefront domain row ${rows.map((row) => `${row.id} (${row.status})`).join(", ")} names it; a storefront-owned binding is never adopted`,
      });
    } else if (bound.length === 0) {
      steps.push({ kind: "custom-domain", hostname, action: "create", detail: "no Custom Domain" });
    } else if (bound.length === 1 && domainIsOurs(bound[0]!, target, manifest)) {
      steps.push({ kind: "custom-domain", hostname, action: "present", detail: `bound as ${bound[0]!.id}` });
    } else {
      steps.push({
        kind: "custom-domain",
        hostname,
        action: "refuse",
        detail: `already bound: ${bound.map((d) => `${d.id} service=${d.service} environment=${d.environment} zone=${d.zoneId}`).join("; ")}`,
      });
    }
  }
  for (const { pattern } of manifest.routes) {
    const matches = snapshot.zoneRoutes.filter((route) => route.pattern === pattern);
    if (!isInZone(routePatternHostname(pattern), snapshot.zone.name)) {
      steps.push({ kind: "route", pattern, action: "refuse", detail: `not in zone ${snapshot.zone.name}` });
    } else if (matches.length === 0) {
      steps.push({ kind: "route", pattern, action: "create", detail: "no Workers Route" });
    } else if (matches.length === 1 && matches[0]!.script === target.workerName) {
      steps.push({ kind: "route", pattern, action: "present", detail: `route ${matches[0]!.id}` });
    } else {
      steps.push({
        kind: "route",
        pattern,
        action: "refuse",
        detail: `already assigned: ${matches.map((r) => `${r.id} script=${r.script ?? "none"}`).join("; ")}`,
      });
    }
  }
  return steps;
}

function subjectOf(step: Plan): string {
  return step.kind === "custom-domain" ? step.hostname : step.pattern;
}

export async function ensurePlatformBindings(input: {
  target: DeployTarget;
  manifest: PlatformManifest;
  read: () => Promise<InventorySnapshot>;
  api: BootstrapApi;
}): Promise<EnsureResult> {
  const { target, manifest } = input;
  const snapshot = await input.read();
  const planned = plan(snapshot, target, manifest);

  if (planned.some((step) => step.action === "refuse")) {
    return {
      status: "refused",
      steps: planned.map((step) => ({
        kind: step.kind,
        subject: subjectOf(step),
        outcome: step.action === "refuse" ? "refused" : step.action === "present" ? "present" : "not-attempted",
        detail: step.detail,
      })),
    };
  }

  const steps: EnsureStep[] = [];
  let stopped: EnsureStep | null = null;
  let refusedMidRun = false;
  for (const step of planned) {
    const subject = subjectOf(step);
    if (stopped) {
      steps.push({ kind: step.kind, subject, outcome: step.action === "present" ? "present" : "not-attempted", detail: step.detail });
      continue;
    }
    if (step.action === "present") {
      steps.push({ kind: step.kind, subject, outcome: "present", detail: step.detail });
      continue;
    }
    // Plan this one write again from a fresh read, immediately before it: an
    // earlier write in this run, or another writer, may have changed what the
    // first read saw. Only a step that is still "create" is written.
    let fresh: InventorySnapshot;
    try {
      fresh = await input.read();
    } catch (error) {
      stopped = {
        kind: step.kind,
        subject,
        outcome: "failed",
        detail: `the read before the write failed (${error instanceof Error ? error.message : String(error)}); run again to resume`,
      };
      steps.push(stopped);
      continue;
    }
    const replanned = plan(fresh, target, manifest);
    // A claim seen anywhere — on this step or on any other, a "present" one
    // included — stops the run before this write.
    const refusal = replanned.find((candidate) => candidate.action === "refuse");
    if (refusal) {
      stopped = {
        kind: refusal.kind,
        subject: subjectOf(refusal),
        outcome: "refused",
        detail: `changed since the first read: ${refusal.detail}`,
      };
      steps.push(stopped);
      refusedMidRun = true;
      continue;
    }
    const again = replanned.find((candidate) => subjectOf(candidate) === subject)!;
    if (again.action !== "create") {
      const outcome: EnsureStep = {
        kind: step.kind,
        subject,
        outcome: again.action === "present" ? "present" : "refused",
        detail: `changed since the first read: ${again.detail}`,
      };
      steps.push(outcome);
      if (outcome.outcome === "refused") {
        stopped = outcome;
        refusedMidRun = true;
      }
      continue;
    }
    const outcome = step.kind === "custom-domain"
      ? await createCustomDomain(step.hostname, input)
      : await createRoute(step.pattern, input);
    steps.push(outcome);
    if (outcome.outcome !== "created" && outcome.outcome !== "present") stopped = outcome;
  }
  return { status: refusedMidRun ? "refused" : stopped ? "failed" : "complete", steps };
}

async function createCustomDomain(
  hostname: string,
  input: Parameters<typeof ensurePlatformBindings>[0],
): Promise<EnsureStep> {
  const { target, manifest, api } = input;
  let writeError: CloudflareWriteError | Error | null = null;
  try {
    await api.attachCustomDomain({
      hostname,
      service: target.workerName,
      environment: target.environment,
      zoneId: manifest.zoneId,
    });
  } catch (error) {
    writeError = error instanceof Error ? error : new Error(String(error));
  }
  // The answer to a PUT proves nothing about who else holds the hostname; the
  // re-read does.
  let after: InventorySnapshot;
  try {
    after = await input.read();
  } catch (error) {
    return {
      kind: "custom-domain",
      subject: hostname,
      outcome: "failed",
      detail: `re-read after the attach failed (${error instanceof Error ? error.message : String(error)}); run again to resume`,
    };
  }
  const bound = after.customDomains.filter((domain) => domain.hostname === hostname);
  if (bound.length === 1 && domainIsOurs(bound[0]!, target, manifest)) {
    return {
      kind: "custom-domain",
      subject: hostname,
      outcome: writeError ? "present" : "created",
      detail: writeError
        ? `the attach answered ${writeError.message}; the re-read shows ${bound[0]!.id} on this Worker`
        : `bound as ${bound[0]!.id}`,
    };
  }
  return {
    kind: "custom-domain",
    subject: hostname,
    outcome: "failed",
    detail: `${writeError ? `the attach answered ${writeError.message}; ` : ""}the re-read shows ${bound.length === 0 ? "no binding" : bound.map((d) => `${d.id} service=${d.service}`).join("; ")}`,
  };
}

async function createRoute(
  pattern: string,
  input: Parameters<typeof ensurePlatformBindings>[0],
): Promise<EnsureStep> {
  const { target, manifest, api } = input;
  let writeError: Error | null = null;
  try {
    await api.createZoneRoute(manifest.zoneId, { pattern, script: target.workerName });
  } catch (error) {
    writeError = error instanceof Error ? error : new Error(String(error));
  }
  let after: InventorySnapshot;
  try {
    after = await input.read();
  } catch (error) {
    return {
      kind: "route",
      subject: pattern,
      outcome: "failed",
      detail: `re-read after the create failed (${error instanceof Error ? error.message : String(error)}); run again to resume`,
    };
  }
  const matches: ZoneRoute[] = after.zoneRoutes.filter((route) => route.pattern === pattern);
  if (matches.length === 1 && matches[0]!.script === target.workerName) {
    return {
      kind: "route",
      subject: pattern,
      outcome: writeError ? "present" : "created",
      detail: writeError
        ? `the create answered ${writeError.message}; the re-read shows route ${matches[0]!.id} on this Worker`
        : `route ${matches[0]!.id}`,
    };
  }
  return {
    kind: "route",
    subject: pattern,
    outcome: "failed",
    detail: `${writeError ? `the create answered ${writeError.message}; ` : ""}the re-read shows ${matches.length === 0 ? "no route" : matches.map((r) => `${r.id} script=${r.script ?? "none"}`).join("; ")}`,
  };
}
