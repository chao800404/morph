import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { loadavg } from "node:os";
import { join } from "node:path";

import { test } from "@playwright/test";

import { MORPH_SDK_SOURCE_HASH } from "../../src/lib/storefront/compiler/morph-sdk-sources.generated";
import { PREVIEW_BRIDGE_SOURCE_HASH } from "../../src/lib/storefront/compiler/preview-bridge-sources.generated";

/**
 * Evidence the M1 acceptance specs keep beside their Playwright results: the
 * version ledger (plan 2.3), one identity record per run of a case (plan 2.4,
 * ROADMAP 1.5) and per-case result records naming the last step verified.
 *
 * Everything here is written from what the spec read back (D1, server
 * function answers, the page), never typed in by hand. Files go to
 * `MORPH_M1_EVIDENCE_DIR/<case>/` when that is set (a handoff directory, out
 * of the repository), else to the test's own output directory. Screenshots
 * go to the same place; nothing here stores a credential, a cookie or a
 * token.
 */

export const sha256 = (text: string | Buffer) =>
  createHash("sha256").update(text).digest("hex");

/** The directory one case keeps its evidence in, created. */
export function evidenceDir(caseLabel: string): string {
  const root = process.env.MORPH_M1_EVIDENCE_DIR;
  const dir = root
    ? join(root, caseLabel)
    : test.info().outputPath(`evidence-${caseLabel}`);
  mkdirSync(dir, { recursive: true });
  return dir;
}

export function writeJson(dir: string, name: string, value: unknown): string {
  const file = join(dir, name);
  writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`);
  return file;
}

function git(...args: string[]): string | null {
  try {
    return execFileSync("git", args, {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
  } catch {
    return null;
  }
}

function packageVersion(name: string): string | null {
  try {
    return (
      (
        JSON.parse(
          readFileSync(
            join(process.cwd(), "node_modules", name, "package.json"),
            "utf8",
          ),
        ) as { version?: string }
      ).version ?? null
    );
  } catch {
    return null;
  }
}

function pnpmVersion(): string | null {
  const agent = process.env.npm_config_user_agent ?? "";
  const match = /\bpnpm\/(\S+)/.exec(agent);
  return match ? match[1]! : null;
}

/** The image the Sandbox containers are built from, as Dockerfile.sandbox names it. */
function sandboxImage(): string | null {
  try {
    const from = /^FROM\s+(\S+)/m.exec(
      readFileSync(join(process.cwd(), "Dockerfile.sandbox"), "utf8"),
    );
    return from ? from[1]! : null;
  } catch {
    return null;
  }
}

/** Plan 2.4's fields. Null where the spec could not read one. */
export type RunIdentity = {
  case: string;
  head: string | null;
  main: string | null;
  freezeSha: string | null;
  themeId: string | null;
  sourceRevisionId: string | null;
  buildId: string | null;
  releaseId: string | null;
  starterVersion: number | null;
  contentTsEdited: boolean | null;
  contentTsSha256: string | null;
  sdkHash: string;
  bridgeHash: string;
  previewMode: string | null;
  transport: string | null;
  runtime: string | null;
  node: string;
  pnpm: string | null;
  wrangler: string | null;
  workerd: string | null;
  sandboxImage: string | null;
  /**
   * Not read by the spec: the docker CLI run from inside the machine lock
   * leaves a dbus-daemon holding it (2026-10-22). The run's wrapper reads it
   * outside the lock and passes it in `MORPH_M1_DOCKER_VERSION`.
   */
  docker: string | null;
  load: number[];
  startedAt: string;
  endedAt: string | null;
};

export function startIdentity(caseLabel: string): RunIdentity {
  return {
    case: caseLabel,
    head: git("rev-parse", "HEAD"),
    main: git("rev-parse", "origin/main"),
    freezeSha: process.env.MORPH_M1_FREEZE_SHA || null,
    themeId: null,
    sourceRevisionId: null,
    buildId: null,
    releaseId: null,
    starterVersion: null,
    contentTsEdited: null,
    contentTsSha256: null,
    sdkHash: MORPH_SDK_SOURCE_HASH,
    bridgeHash: PREVIEW_BRIDGE_SOURCE_HASH,
    previewMode: null,
    transport: process.env.E2E_EXPECT_PREVIEW_TRANSPORT ?? null,
    runtime: process.env.MORPH_E2E_PREVIEW_RUNTIME ?? null,
    node: process.version,
    pnpm: pnpmVersion(),
    wrangler: packageVersion("wrangler"),
    workerd: packageVersion("workerd"),
    sandboxImage: sandboxImage(),
    docker: process.env.MORPH_M1_DOCKER_VERSION || null,
    load: loadavg(),
    startedAt: new Date().toISOString(),
    endedAt: null,
  };
}

/** Plan 2.3: one row per version a case created. */
export type LedgerRow = {
  n: number;
  timeUtc: string;
  step: string;
  action: string;
  themeId: string | null;
  sourceRevisionId: string | null;
  templateDraftGeneration: number | null;
  buildId: string | null;
  /** The build was reused (`contentDependency: "independent"`), not made. */
  buildReused: boolean | null;
  contentPublicationId: string | null;
  releaseId: string | null;
  activeRelease: { before: string | null; after: string | null };
  /** For a rollback: the CAS's `expectedActiveReleaseId`. */
  expectedActiveReleaseId: string | null;
  evidence: string[];
};

export class Ledger {
  readonly rows: LedgerRow[] = [];
  constructor(
    private readonly dir: string,
    private readonly name = "ledger.json",
  ) {}

  add(row: Omit<LedgerRow, "n" | "timeUtc">): LedgerRow {
    const full = {
      n: this.rows.length + 1,
      timeUtc: new Date().toISOString(),
      ...row,
    };
    this.rows.push(full);
    this.write();
    return full;
  }

  write() {
    writeJson(this.dir, this.name, this.rows);
  }
}

export type StepRecord = {
  name: string;
  status: "passed" | "failed";
  at: string;
  detail?: unknown;
  error?: string;
};

/**
 * One case's result record: every step it reached, in order, and the last
 * one that passed. Written after each step, so a failure leaves the record
 * of what was verified before it.
 */
export class CaseRecord {
  readonly steps: StepRecord[] = [];
  readonly facts: Record<string, unknown> = {};
  constructor(
    private readonly dir: string,
    readonly label: string,
    readonly identity: RunIdentity,
  ) {}

  /** The last step of the unbroken run of passed steps from the start. */
  get lastVerified(): string | null {
    let last: string | null = null;
    for (const step of this.steps) {
      if (step.status !== "passed") break;
      last = step.name;
    }
    return last;
  }

  /**
   * Runs `body` as a Playwright step and records how it ended. A soft
   * assertion that failed inside it marks the step failed too, though the
   * test goes on.
   */
  async step<T>(name: string, body: () => Promise<T>): Promise<T> {
    const errorsBefore = test.info().errors.length;
    try {
      const value = await test.step(name, body);
      const soft = test.info().errors.slice(errorsBefore);
      this.steps.push({
        name,
        status: soft.length ? "failed" : "passed",
        at: new Date().toISOString(),
        ...(soft.length
          ? {
              error: `soft: ${String(soft[0]!.message ?? "")
                .split("\n")[0]!
                .slice(0, 400)}`,
            }
          : {}),
      });
      this.write();
      return value;
    } catch (error) {
      this.steps.push({
        name,
        status: "failed",
        at: new Date().toISOString(),
        // The first line only: an assertion's message, never a page body.
        error: String((error as Error)?.message ?? error)
          .split("\n")[0]!
          .slice(0, 400),
      });
      this.write();
      throw error;
    }
  }

  fact(key: string, value: unknown) {
    this.facts[key] = value;
    this.write();
  }

  write(ended = false) {
    if (ended) this.identity.endedAt = new Date().toISOString();
    writeJson(this.dir, "result.json", {
      case: this.label,
      lastVerified: this.lastVerified,
      failed: this.steps.find((step) => step.status === "failed")?.name ?? null,
      steps: this.steps,
      facts: this.facts,
    });
    writeJson(this.dir, "identity.json", this.identity);
  }
}
