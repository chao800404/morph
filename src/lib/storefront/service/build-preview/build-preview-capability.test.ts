import Database from "better-sqlite3";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { getDb } from "@/db";
import * as schema from "@/db/schema";
import { storefrontBuildPreviewCapabilityDal as dal } from "../../dal/storefront-build-preview-capability.dal";
import {
  buildPreviewHostname,
  buildPreviewTokenFromHost,
  hashBuildPreviewToken,
  issueBuildPreviewCapability,
  verifyBuildPreviewCapability,
} from "./build-preview-capability";

vi.mock("cloudflare:workers", () => ({ env: {} }));
vi.mock("@/db", () => ({ getDb: vi.fn() }));

let sqlite: Database.Database;
const NOW = new Date("2026-10-07T00:00:00.000Z");
const later = (ms: number) => new Date(NOW.getTime() + ms);

beforeEach(() => {
  sqlite = new Database(":memory:");
  sqlite.pragma("foreign_keys = ON");
  // Only the columns the capability reads; the table itself is the migration's.
  sqlite.exec(`
    CREATE TABLE users (id text PRIMARY KEY, role text, banned integer);
    CREATE TABLE storefronts (id text PRIMARY KEY);
    CREATE TABLE storefront_themes (
      id text PRIMARY KEY, storefront_id text NOT NULL, deleted_at text
    );
    CREATE TABLE storefront_theme_builds (
      id text PRIMARY KEY, storefront_id text NOT NULL, theme_id text NOT NULL,
      status text NOT NULL, artifact_prefix text, content_publication_id text,
      deleted_at text
    );
    CREATE TABLE storefront_releases (
      id text PRIMARY KEY, storefront_id text NOT NULL, theme_id text NOT NULL,
      theme_build_id text NOT NULL, content_publication_id text, deleted_at text
    );
    INSERT INTO users VALUES ('admin-1', 'admin', 0), ('guest-1', 'guest', 0);
    INSERT INTO storefronts VALUES ('store-a');
    INSERT INTO storefront_themes VALUES ('theme-a', 'store-a', NULL);
    INSERT INTO storefront_theme_builds VALUES
      ('build-ok', 'store-a', 'theme-a', 'succeeded', 'builds/ok/', 'pub-1', NULL),
      ('build-running', 'store-a', 'theme-a', 'building', NULL, NULL, NULL),
      ('build-other', 'store-a', 'theme-a', 'succeeded', 'builds/other/', NULL, NULL);
    INSERT INTO storefront_releases VALUES
      ('release-1', 'store-a', 'theme-a', 'build-ok', 'pub-of-release', NULL),
      ('release-other-build', 'store-a', 'theme-a', 'build-other', 'pub-x', NULL);
  `);
  for (const migration of [
    "drizzle/0072_build_preview_capabilities.sql",
    "drizzle/0074_build_preview_release.sql",
  ]) {
    sqlite.exec(
      readFileSync(resolve(migration), "utf8")
        .split("--> statement-breakpoint")
        .join("\n"),
    );
  }
  vi.mocked(getDb).mockResolvedValue(drizzle(sqlite, { schema }) as never);
});

afterEach(() => sqlite.close());

const issue = (
  overrides: Partial<{
    buildId: string;
    releaseId: string;
    userId: string;
  }> = {},
) =>
  issueBuildPreviewCapability({
    dal,
    storefrontId: "store-a",
    themeId: "theme-a",
    buildId: "build-ok",
    userId: "admin-1",
    now: NOW,
    ...overrides,
  });

async function issuedToken(overrides: Parameters<typeof issue>[0] = {}) {
  const issued = await issue(overrides);
  if (!issued.ok) throw new Error(issued.reason);
  return issued.token;
}

const verify = (token: string, now = later(1000)) =>
  verifyBuildPreviewCapability({ dal, token, now });

describe("the Build Preview host", () => {
  const env = { THEME_PREVIEW_HOSTNAME: "preview.example.test" };
  const token = "0123456789abcdef0123456789abcdef01234567";

  it("carries the token as one label under the preview host", () => {
    const host = buildPreviewHostname(token, "preview.example.test");
    expect(host).toBe(`bp-${token}.preview.example.test`);
    expect(buildPreviewTokenFromHost(host, env)).toBe(token);
    expect(buildPreviewTokenFromHost(`${host}:443`, env)).toBe(token);
  });

  it.each([
    ["the preview host itself", "preview.example.test"],
    ["a Live Preview sandbox label", "5173-abc.preview.example.test"],
    ["a deeper name", `x.bp-${token}.preview.example.test`],
    ["a short token", "bp-0123.preview.example.test"],
    ["a long token", `bp-${token}0.preview.example.test`],
    ["a token that is not hex", `bp-${"g".repeat(40)}.preview.example.test`],
    ["another site", `bp-${token}.example.test`],
  ])("is not %s", (_name, host) => {
    expect(buildPreviewTokenFromHost(host, env)).toBeNull();
  });

  it("is nothing without a configured preview host", () => {
    expect(
      buildPreviewTokenFromHost(`bp-${token}.preview.example.test`, {}),
    ).toBeNull();
  });
});

describe("a Build Preview capability", () => {
  it("is stored only as a hash", async () => {
    const token = await issuedToken();
    const rows = sqlite
      .prepare("SELECT token_hash FROM storefront_build_preview_capabilities")
      .all() as { token_hash: string }[];
    expect(rows).toEqual([{ token_hash: await hashBuildPreviewToken(token) }]);
    expect(JSON.stringify(rows)).not.toContain(token);
  });

  it("verifies to its user, store, Theme, build and content snapshot", async () => {
    const result = await verify(await issuedToken());
    expect(result).toEqual({
      ok: true,
      capability: expect.objectContaining({
        storefrontId: "store-a",
        themeId: "theme-a",
        buildId: "build-ok",
        userId: "admin-1",
        contentPublicationId: "pub-1",
      }),
    });
  });

  it("is refused once expired", async () => {
    const token = await issuedToken();
    expect(await verify(token, later(60 * 60_000))).toEqual({
      ok: false,
      reason: "CAPABILITY_EXPIRED",
    });
  });

  it("is refused for a token it never issued", async () => {
    expect(await verify("f".repeat(40))).toEqual({
      ok: false,
      reason: "CAPABILITY_UNKNOWN",
    });
    expect(await verify("not-a-token")).toEqual({
      ok: false,
      reason: "CAPABILITY_UNKNOWN",
    });
  });

  it("is revoked by a newer one for the same user and build", async () => {
    const first = await issuedToken();
    const second = await issuedToken();
    expect(await verify(first)).toEqual({
      ok: false,
      reason: "CAPABILITY_REVOKED",
    });
    expect((await verify(second)).ok).toBe(true);
  });

  it("is revoked only by the user who holds it", async () => {
    const token = await issuedToken();
    const tokenHash = await hashBuildPreviewToken(token);
    const now = NOW.toISOString();
    expect(await dal.revoke({ tokenHash, userId: "guest-1", now })).toBe(false);
    expect((await verify(token)).ok).toBe(true);
    expect(await dal.revoke({ tokenHash, userId: "admin-1", now })).toBe(true);
    expect((await verify(token)).ok).toBe(false);
  });

  it("stops working when its user loses access", async () => {
    const token = await issuedToken();
    sqlite.exec("UPDATE users SET role = 'guest' WHERE id = 'admin-1'");
    expect(await verify(token)).toEqual({
      ok: false,
      reason: "USER_NOT_AUTHORIZED",
    });
    sqlite.exec(
      "UPDATE users SET role = 'admin', banned = 1 WHERE id = 'admin-1'",
    );
    expect((await verify(token)).ok).toBe(false);
    sqlite.exec("DELETE FROM users WHERE id = 'admin-1'");
    expect((await verify(token)).ok).toBe(false);
  });

  it("stops working when the build or its Theme does", async () => {
    const token = await issuedToken();
    sqlite.exec(
      "UPDATE storefront_theme_builds SET status = 'failed' WHERE id = 'build-ok'",
    );
    expect(await verify(token)).toEqual({
      ok: false,
      reason: "BUILD_NOT_PREVIEWABLE",
    });
    sqlite.exec(
      "UPDATE storefront_theme_builds SET status = 'succeeded' WHERE id = 'build-ok'",
    );
    sqlite.exec(
      "UPDATE storefront_themes SET deleted_at = 'x' WHERE id = 'theme-a'",
    );
    expect(await verify(token)).toEqual({
      ok: false,
      reason: "BUILD_NOT_PREVIEWABLE",
    });
  });

  it("is never issued for a build that is not previewable or a user without access", async () => {
    expect(await issue({ buildId: "build-running" })).toEqual({
      ok: false,
      reason: "BUILD_NOT_PREVIEWABLE",
    });
    expect(await issue({ userId: "guest-1" })).toEqual({
      ok: false,
      reason: "USER_NOT_AUTHORIZED",
    });
    const live = sqlite
      .prepare(
        "SELECT count(*) AS n FROM storefront_build_preview_capabilities WHERE revoked_at IS NULL",
      )
      .get() as { n: number };
    expect(live.n).toBe(0);
  });

  it("goes with its build", async () => {
    await issuedToken();
    sqlite.exec("DELETE FROM storefront_theme_builds WHERE id = 'build-ok'");
    const left = sqlite
      .prepare(
        "SELECT count(*) AS n FROM storefront_build_preview_capabilities",
      )
      .get() as { n: number };
    expect(left.n).toBe(0);
  });
});

describe("a release preview capability", () => {
  const forRelease = () => issuedToken({ releaseId: "release-1" });

  it("answers with the release's content, not the build's seal", async () => {
    expect(await verify(await forRelease())).toEqual({
      ok: true,
      capability: expect.objectContaining({
        buildId: "build-ok",
        releaseId: "release-1",
        contentPublicationId: "pub-of-release",
      }),
    });
  });

  it("answers with no content when the release has none, never the seal", async () => {
    const token = await forRelease();
    sqlite.exec(
      "UPDATE storefront_releases SET content_publication_id = NULL WHERE id = 'release-1'",
    );
    expect(await verify(token)).toEqual({
      ok: true,
      capability: expect.objectContaining({ contentPublicationId: null }),
    });
  });

  it("is never issued for a release of another build", async () => {
    expect(
      await issue({ buildId: "build-ok", releaseId: "release-other-build" }),
    ).toEqual({ ok: false, reason: "RELEASE_NOT_PREVIEWABLE" });
  });

  it("stops working when its release is removed or moved to another store or Theme", async () => {
    const token = await forRelease();
    sqlite.exec(
      "UPDATE storefront_releases SET theme_id = 'theme-b' WHERE id = 'release-1'",
    );
    expect(await verify(token)).toEqual({
      ok: false,
      reason: "RELEASE_NOT_PREVIEWABLE",
    });
    sqlite.exec(
      "UPDATE storefront_releases SET theme_id = 'theme-a', storefront_id = 'store-b' WHERE id = 'release-1'",
    );
    expect((await verify(token)).ok).toBe(false);
    sqlite.exec(
      "UPDATE storefront_releases SET storefront_id = 'store-a', deleted_at = 'x' WHERE id = 'release-1'",
    );
    expect(await verify(token)).toEqual({
      ok: false,
      reason: "RELEASE_NOT_PREVIEWABLE",
    });
  });

  it("still needs its build to be previewable", async () => {
    const token = await forRelease();
    sqlite.exec(
      "UPDATE storefront_theme_builds SET status = 'failed' WHERE id = 'build-ok'",
    );
    expect(await verify(token)).toEqual({
      ok: false,
      reason: "BUILD_NOT_PREVIEWABLE",
    });
  });

  it("and the build's own preview do not revoke each other", async () => {
    const build = await issuedToken();
    const release = await forRelease();
    expect((await verify(build)).ok).toBe(true);
    expect((await verify(release)).ok).toBe(true);
    const newer = await forRelease();
    expect(await verify(release)).toEqual({
      ok: false,
      reason: "CAPABILITY_REVOKED",
    });
    expect((await verify(newer)).ok).toBe(true);
    expect((await verify(build)).ok).toBe(true);
  });

  it("goes with its release", async () => {
    await forRelease();
    sqlite.exec("DELETE FROM storefront_releases WHERE id = 'release-1'");
    const left = sqlite
      .prepare(
        "SELECT count(*) AS n FROM storefront_build_preview_capabilities",
      )
      .get() as { n: number };
    expect(left.n).toBe(0);
  });
});
