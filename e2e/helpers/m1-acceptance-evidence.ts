import { execFileSync, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { loadavg } from "node:os";
import path from "node:path";

import { expect, test, type Page } from "@playwright/test";

import { queryLifecycleD1 } from "../../scripts/verify-published-artifact.mjs";
import { PREVIEW_BRIDGE_SOURCE_HASH } from "../../src/lib/storefront/compiler/preview-bridge-sources.generated";
import { MORPH_SDK_SOURCE_HASH } from "../../src/lib/storefront/compiler/morph-sdk-sources.generated";
import { decodeServerFnResult, isServerFunctionCall } from "../helpers";
import { serverFn } from "../native-acceptance";

/**
 * M1 acceptance evidence (handoff 2026-11-21 m1-acceptance-plan.md, 2.3 and
 * 2.4), written by the specs themselves into the run's output directory so
 * nothing in it is hand-copied:
 *
 *   <out>/m1-<item>-<spec>-ledger.json    one row per revision, build,
 *                                         publication and release the spec
 *                                         made, every id read from D1
 *   <out>/m1-<item>-<spec>-identity.json  the run's identity record (2.4)
 *
 * `<out>` is `M1_EVIDENCE_DIR` when set, otherwise the Playwright output
 * directory (`--output`). Both files are rewritten on every change, so a run
 * that dies part-way still leaves what it had.
 *
 * The preview runtime (Q10): `recordFullStartTheme` records full Start on the
 * Theme through the editor's own compare-and-set write and reads it back from
 * D1; `observePreviewStarts` reads what each `startThemePreviewServer` answer
 * says served it (`kind`, the transport, and `previewRuntime`), and
 * `expectFullStartObserved` requires at least one such answer and every one
 * of them to be the container transport and full Start. Neither the record
 * nor the Worker's default alone counts as the runtime having been used.
 */

const PREVIEW_SERVER = "/src/server/storefront/storefront-theme-preview-server.serverFn.ts";
const CONTENT_TS = "src/morph/content.ts";
const THEME_FILES = "/src/server/storefront/storefront-theme-files.serverFn.ts";
/** Product paths the freeze diff must leave untouched (plan 2.1). */
const PRODUCT_PATHS = [
  "src/",
  "packages/",
  "public/",
  "drizzle/",
  "wrangler.jsonc",
  "Dockerfile.sandbox",
  "package.json",
  "pnpm-lock.yaml",
];

type Scope = Readonly<{ storefrontId: string; themeId: string }>;

export type LedgerRow = {
  n: number;
  atUtc: string;
  item: string;
  case: string;
  step: string;
  action: string;
  themeId: string;
  /** The theme's source generation, and its latest source revision, at the row. */
  themeSourceGeneration: number | null;
  latestSourceRevisionId: string | null;
  /** The case's own route Document, when the row is about one. */
  templateId: string | null;
  routePath: string | null;
  templateDraftGeneration: number | null;
  templateDraftRevisionId: string | null;
  /** A release row's own ids, and its build's. */
  releaseId: string | null;
  releaseSourceRevisionId: string | null;
  buildId: string | null;
  buildSourceRevisionId: string | null;
  buildContentDependency: string | null;
  /** "reused build <id>" when the release's build sealed another publication. */
  buildReuse: string | null;
  contentPublicationId: string | null;
  activeBefore: string | null;
  activeAfter: string | null;
  expectedActiveReleaseId: string | null;
  result: string | null;
  evidence: string[];
  /**
   * The release Core served for the storefront's host right after the step,
   * read from the ETag of its content read (`servedRelease`), when the step
   * reached the public site.
   */
  servedReleaseId: string | null;
  /**
   * Every item the release's own content publication pins, read from D1:
   * which revision each template (page, route Document, layout) and Page
   * used in that release.
   */
  pins: PublicationPin[] | null;
  /** Step-specific version ids (draft, published, pinned) the spec checked. */
  detail: Record<string, unknown> | null;
};

export type PublicationPin = {
  itemType: string;
  contentId: string;
  revisionId: string;
  templateType: string | null;
  routePath: string | null;
};

export type PreviewStart = {
  atUtc: string;
  test: string;
  /** null: the answer could not be read or decoded. Q10 fails on it. */
  success: boolean | null;
  /** Why the answer could not be decoded, when it could not. */
  undecodable: string | null;
  kind: string | null;
  previewRuntime: string | null;
  workspaceFingerprint: string | null;
};

const git = (...args: string[]) => {
  try {
    return execFileSync("git", args, { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();
  } catch {
    return null;
  }
};

const packageVersion = (name: string, from?: string) => {
  try {
    const require = createRequire(from ?? path.join(process.cwd(), "package.json"));
    const file = require.resolve(`${name}/package.json`);
    return { version: (JSON.parse(readFileSync(file, "utf8")) as { version: string }).version, file };
  } catch {
    return null;
  }
};

const sandboxImageLine = () => {
  try {
    return (
      readFileSync(path.join(process.cwd(), "Dockerfile.sandbox"), "utf8")
        .split("\n")
        .find((line) => /^FROM\s/i.test(line.trim()))
        ?.trim() ?? null
    );
  } catch {
    return null;
  }
};

export function m1Evidence(options: {
  item: string;
  spec: string;
  scope: Scope;
  stateDir: string;
}) {
  const { item, spec, scope, stateDir } = options;
  const rows: LedgerRow[] = [];
  const starts: PreviewStart[] = [];
  /** Response listeners still reading an answer; Q10 awaits them first. */
  const pendingStarts = new Set<Promise<void>>();
  const startedAt = new Date().toISOString();
  let outDir: string | null = null;
  let identityExtra: Record<string, unknown> = {};

  const q = (sql: string, ...params: unknown[]) =>
    queryLifecycleD1(stateDir, sql, ...params) as Array<Record<string, unknown>>;
  const one = (sql: string, ...params: unknown[]) => q(sql, ...params)[0] ?? null;
  const str = (value: unknown) => (value === null || value === undefined ? null : String(value));
  const num = (value: unknown) => (value === null || value === undefined ? null : Number(value));

  const dir = () => {
    if (!outDir) {
      outDir = process.env.M1_EVIDENCE_DIR ?? test.info().project.outputDir;
      mkdirSync(outDir, { recursive: true });
    }
    return outDir;
  };
  const file = (kind: "ledger" | "identity") => path.join(dir(), `m1-${item}-${spec}-${kind}.json`);

  const writeLedger = () =>
    writeFileSync(
      file("ledger"),
      `${JSON.stringify({ schema: "m1-ledger/1", item, spec, themeId: scope.themeId, storefrontId: scope.storefrontId, rows, previewStarts: starts }, null, 2)}\n`,
    );

  const themeRow = () =>
    one(
      `SELECT t.source_generation AS sourceGeneration, t.preview_runtime AS previewRuntime,
              t.framework AS framework, t.metadata AS metadata, s.active_release_id AS active,
              (SELECT r.id FROM storefront_theme_revisions r WHERE r.theme_id = t.id
                ORDER BY r.revision_number DESC LIMIT 1) AS latestRevision
         FROM storefront_themes t JOIN storefronts s ON s.id = t.storefront_id
        WHERE t.id = ?1 AND t.storefront_id = ?2`,
      scope.themeId,
      scope.storefrontId,
    );

  /** What a release's own content publication pins, item by item. */
  const pins = (releaseId: string): PublicationPin[] =>
    q(
      `SELECT i.item_type AS itemType, i.content_id AS contentId, i.revision_id AS revisionId,
              json_extract(i.metadata, '$.templateType') AS templateType,
              json_extract(i.metadata, '$.routePath') AS routePath
         FROM storefront_releases r
         JOIN storefront_content_publication_items i
           ON i.publication_id = r.content_publication_id AND i.deleted_at IS NULL
        WHERE r.id = ?1 AND r.storefront_id = ?2
        ORDER BY i.item_type, routePath, i.content_id`,
      releaseId,
      scope.storefrontId,
    ).map((pin) => ({
      itemType: String(pin.itemType),
      contentId: String(pin.contentId),
      revisionId: String(pin.revisionId),
      templateType: str(pin.templateType),
      routePath: str(pin.routePath),
    }));

  /** The active release of the storefront, read from D1. */
  const activeRelease = () => str(themeRow()?.active);

  /**
   * Appends one row. Every id comes from D1 at the moment of the call:
   * the theme, the case's route Document (`routePath`), and the release
   * (`releaseId`) with its build and publication.
   */
  const ledger = (row: {
    case: string;
    step: string;
    action: string;
    routePath?: string | null;
    releaseId?: string | null;
    activeBefore?: string | null;
    activeAfter?: string | null;
    expectedActiveReleaseId?: string | null;
    result?: string | null;
    evidence?: string[];
    servedReleaseId?: string | null;
    detail?: Record<string, unknown> | null;
  }) => {
    const theme = themeRow();
    const template = row.routePath
      ? one(
          `SELECT id, draft_generation AS draftGeneration, draft_revision_id AS draftRevisionId
             FROM storefront_theme_templates
            WHERE theme_id = ?1 AND route_path = ?2 AND deleted_at IS NULL`,
          scope.themeId,
          row.routePath,
        )
      : null;
    const release = row.releaseId
      ? one(
          `SELECT r.id AS id, r.source_revision_id AS sourceRevisionId, r.theme_build_id AS buildId,
                  r.content_publication_id AS publicationId,
                  b.source_revision_id AS buildSourceRevisionId, b.content_dependency AS dependency,
                  b.content_publication_id AS buildPublicationId
             FROM storefront_releases r JOIN storefront_theme_builds b ON b.id = r.theme_build_id
            WHERE r.id = ?1 AND r.storefront_id = ?2`,
          row.releaseId,
          scope.storefrontId,
        )
      : null;
    if (row.releaseId) expect(release, `ledger: release ${row.releaseId} is in D1`).not.toBeNull();
    const buildReuse =
      release && release.buildPublicationId !== release.publicationId
        ? `reused build ${String(release.buildId)} (sealed publication ${str(release.buildPublicationId)})`
        : null;
    rows.push({
      n: rows.length + 1,
      atUtc: new Date().toISOString(),
      item,
      case: row.case,
      step: row.step,
      action: row.action,
      themeId: scope.themeId,
      themeSourceGeneration: num(theme?.sourceGeneration),
      latestSourceRevisionId: str(theme?.latestRevision),
      templateId: str(template?.id),
      routePath: row.routePath ?? null,
      templateDraftGeneration: num(template?.draftGeneration),
      templateDraftRevisionId: str(template?.draftRevisionId),
      releaseId: str(release?.id),
      releaseSourceRevisionId: str(release?.sourceRevisionId),
      buildId: str(release?.buildId),
      buildSourceRevisionId: str(release?.buildSourceRevisionId),
      buildContentDependency: str(release?.dependency),
      buildReuse,
      contentPublicationId: str(release?.publicationId),
      activeBefore: row.activeBefore ?? null,
      activeAfter: row.activeAfter ?? null,
      expectedActiveReleaseId: row.expectedActiveReleaseId ?? null,
      result: row.result ?? null,
      evidence: row.evidence ?? [],
      servedReleaseId: row.servedReleaseId ?? null,
      pins: release ? pins(String(release.id)) : null,
      detail: row.detail ?? null,
    });
    writeLedger();
    return rows[rows.length - 1]!;
  };

  /** Records every preview start answer `page` receives. */
  const observePreviewStarts = (page: Page) => {
    const title = test.info().title;
    page.on("response", (response) => {
      if (!isServerFunctionCall(response.url(), "startThemePreviewServer")) return;
      const read = (async () => {
        let undecodable: string | null = null;
        let decoded: Record<string, unknown> | null = null;
        try {
          decoded = decodeServerFnResult(await response.text()) as Record<string, unknown>;
          if (!decoded || typeof decoded.success !== "boolean") {
            undecodable = "the answer has no boolean success";
          }
        } catch (error) {
          undecodable = `unreadable answer: ${error instanceof Error ? error.message : String(error)}`.slice(0, 300);
          decoded = null;
        }
        const data = (decoded?.data ?? null) as Record<string, unknown> | null;
        starts.push({
          atUtc: new Date().toISOString(),
          test: title,
          success: undecodable ? null : (decoded!.success as boolean),
          undecodable,
          kind: str(data?.kind),
          previewRuntime: str(data?.previewRuntime),
          workspaceFingerprint: str(data?.workspaceFingerprint),
        });
        writeLedger();
      })();
      pendingStarts.add(read);
      void read.finally(() => pendingStarts.delete(read));
    });
  };

  /**
   * Q10: at least one preview start was answered in this spec, and every
   * answer it received (failed ones included) was decodable, successful and
   * named the container transport and full Start. Answers still being read
   * are awaited first, so a late one is not missed.
   */
  const expectFullStartObserved = async () => {
    while (pendingStarts.size > 0) await Promise.all([...pendingStarts]);
    expect(starts.length, "a preview start was observed in this spec").toBeGreaterThan(0);
    expect(
      starts.map((start) =>
        start.success === null
          ? `undecodable (${start.undecodable}) in ${start.test}`
          : `${start.success ? "ok" : "failed"}/${start.kind}/${start.previewRuntime}`,
      ),
      "every preview start answer was decodable, succeeded, and came from the container transport under full Start",
    ).toEqual(starts.map(() => "ok/cloudflare-sandbox/start"));
  };

  /**
   * Q10: the Theme records full Start, written through the editor's own
   * compare-and-set (`setThemePreviewRuntime`) and read back from D1.
   */
  const recordFullStartTheme = async (page: Page) => {
    const before = str(themeRow()?.previewRuntime);
    if (before !== "start") {
      const saved = (await serverFn(page, PREVIEW_SERVER, "setThemePreviewRuntime", {
        ...scope,
        previewRuntime: "start",
        expectedPreviewRuntime: before,
      })) as { success: boolean; message?: string; error?: string };
      expect(saved.success, `record full Start: ${saved.error ?? saved.message}`).toBe(true);
    }
    const after = str(themeRow()?.previewRuntime);
    expect(after, "the Theme records full Start in D1").toBe("start");
    identityExtra = { ...identityExtra, previewRuntimeRecordedBefore: before };
    return { before, after };
  };

  const contentTsSha256 = async (page: Page) => {
    const content = (await page.evaluate(
      async ({ module, scope, path }) => {
        const fns = await import(/* @vite-ignore */ module);
        const result = await fns.getStorefrontThemeFile({ data: { ...scope, path } });
        return result?.success ? (result.data.content as string) : null;
      },
      { module: THEME_FILES, scope, path: CONTENT_TS },
    )) as string | null;
    expect(content, `${CONTENT_TS} is readable through the editor's file read`).not.toBeNull();
    return createHash("sha256").update(content!).digest("hex");
  };

  /** Extra identity fields a spec learns as it runs (release ids, hashes). */
  const note = (extra: Record<string, unknown>) => {
    identityExtra = { ...identityExtra, ...extra };
  };

  /** The run's identity record (plan 2.4), rewritten with what is known now. */
  const writeIdentity = (ended: boolean) => {
    const theme = themeRow();
    const freezeSha = process.env.M1_FREEZE_SHA || null;
    const head = git("rev-parse", "HEAD");
    let productDiffEmpty: boolean | null = null;
    let productDiffCheck: string;
    if (!freezeSha) {
      productDiffCheck = "operator must verify: M1_FREEZE_SHA is not set, so the product diff was not checked";
    } else {
      expect(head, "the run's head is readable").not.toBeNull();
      const diff = spawnSync("git", ["diff", "--quiet", freezeSha, head!, "--", ...PRODUCT_PATHS], { stdio: "ignore" });
      // 0 = no diff, 1 = a diff; anything else means the check itself failed.
      expect([0, 1], `git diff ${freezeSha}..${head} ran (status ${diff.status})`).toContain(diff.status);
      productDiffEmpty = diff.status === 0;
      productDiffCheck = productDiffEmpty
        ? `checked: no product diff between ${freezeSha} and ${head}`
        : `FAILED: ${head} changes product paths against ${freezeSha}`;
    }
    let starterVersion: number | null = null;
    try {
      starterVersion =
        (JSON.parse(String(theme?.metadata ?? "{}")) as { starterTemplateVersion?: number })
          .starterTemplateVersion ?? null;
    } catch {
      starterVersion = null;
    }
    const lastRelease = [...rows].reverse().find((row) => row.releaseId);
    const wrangler = packageVersion("wrangler");
    const identity = {
      schema: "m1-identity/1",
      item,
      spec,
      head,
      main: git("rev-parse", "origin/main"),
      freezeSha,
      productDiffEmpty,
      productDiffCheck,
      productPaths: PRODUCT_PATHS,
      storefrontId: scope.storefrontId,
      themeId: scope.themeId,
      sourceRevisionId: lastRelease?.releaseSourceRevisionId ?? str(theme?.latestRevision),
      buildId: lastRelease?.buildId ?? null,
      releaseId: str(theme?.active),
      starterVersion,
      sdkHash: MORPH_SDK_SOURCE_HASH,
      bridgeHash: PREVIEW_BRIDGE_SOURCE_HASH,
      previewMode: str(theme?.previewRuntime),
      transport: process.env.E2E_EXPECT_PREVIEW_TRANSPORT ?? null,
      runtime: process.env.MORPH_E2E_PREVIEW_RUNTIME ?? null,
      observedPreviewStarts: starts.map((start) => `${start.kind}/${start.previewRuntime}/${start.success}`),
      node: process.version,
      pnpm: /pnpm\/(\S+)/.exec(process.env.npm_config_user_agent ?? "")?.[1] ?? null,
      wrangler: wrangler?.version ?? null,
      workerd: wrangler ? (packageVersion("workerd", wrangler.file)?.version ?? null) : null,
      miniflare: wrangler ? (packageVersion("miniflare", wrangler.file)?.version ?? null) : null,
      cloudflareSandbox: packageVersion("@cloudflare/sandbox")?.version ?? null,
      tanstackReactStart: packageVersion("@tanstack/react-start")?.version ?? null,
      playwright: packageVersion("@playwright/test")?.version ?? null,
      sandboxImage: sandboxImageLine(),
      // Not run here: the spec runs inside the runner's machine lock, and no
      // docker command runs under a lock (it left dbus-daemon holding the
      // shared lock, 2026-10-22). The dev-run script reads it before taking
      // the lock and passes it in M1_DOCKER_VERSION.
      docker: process.env.M1_DOCKER_VERSION || null,
      dockerNote: process.env.M1_DOCKER_VERSION
        ? "read by the run script outside the lock (M1_DOCKER_VERSION)"
        : "not read: no docker command runs under the machine lock and M1_DOCKER_VERSION was not set; the run script's env-before.txt records it",
      load: loadavg(),
      startedAt,
      endedAt: ended ? new Date().toISOString() : null,
      ...identityExtra,
    };
    writeFileSync(file("identity"), `${JSON.stringify(identity, null, 2)}\n`);
    // Written first, so a refused run still leaves its record.
    if (freezeSha) {
      expect(productDiffEmpty, `identity: ${productDiffCheck}`).toBe(true);
    }
    return identity;
  };

  return {
    ledger,
    pins,
    activeRelease,
    observePreviewStarts,
    expectFullStartObserved,
    recordFullStartTheme,
    contentTsSha256,
    note,
    writeIdentity,
    /** Where the evidence files go, for screenshots beside them. */
    evidenceDir: dir,
  };
}
