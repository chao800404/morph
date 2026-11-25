// node --test scripts/e2e-client-lane-guard.test.mjs
import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, before, describe, test } from "node:test";

import {
  CLIENT_LANE_STARTER_FIXTURE,
  CLIENT_LANE_THEME_SLOTS,
  REQUIRE_CLIENT_LANE_VAR,
  clientLaneEditorPath,
  clientLaneEvidenceRefusal,
  clientLaneThemeRefusal,
  clientLaneVerdict,
  clientLaneVerdictsRefusal,
  contentSha256,
  fixtureFileDigests,
  isClientLaneRun,
  readFixtureFileDigests,
  requiredClientLaneRefusal,
} from "./e2e-client-lane-guard.mjs";

const expected = readFixtureFileDigests();
const STOREFRONT = "00000000-0000-4000-8000-000000000002";

const hex = (n) => n.toString(16).padStart(12, "0");
const themeId = (i) => `00000000-0000-4000-8000-${hex(0x100 + i)}`;
const templateId = (i) => `00000000-0000-4000-8000-${hex(0x200 + i)}`;

/** What the seed reads back for a Starter 31 client Theme. */
function seededTheme(i) {
  return {
    storefrontId: STOREFRONT,
    themeId: themeId(i),
    rows: 1,
    rowStorefrontId: STOREFRONT,
    previewRuntime: null,
    framework: null,
    deletedAt: null,
    starterTemplateVersion: 31,
    files: expected.map((file) => ({ ...file })),
    templates: [
      { id: templateId(i), type: "index", routePath: null },
      { id: `${templateId(i)}-l`, type: "layout", routePath: null },
      { id: `${templateId(i)}-p`, type: "product", routePath: null },
    ],
  };
}

function themesRecord(mutate = (themes) => themes) {
  const themes = CLIENT_LANE_THEME_SLOTS.map((slot, i) => {
    const entry = {
      slot,
      storefrontId: STOREFRONT,
      themeId: themeId(i),
      indexTemplateId: templateId(i),
    };
    return { ...entry, editorPath: clientLaneEditorPath(entry), seeded: seededTheme(i) };
  });
  return JSON.stringify({ version: 1, starterVersion: 31, themes: mutate(themes) });
}

const afterSuite = (overrides = {}) =>
  CLIENT_LANE_THEME_SLOTS.map((_, i) => ({
    themeId: themeId(i),
    rows: 1,
    previewRuntime: null,
    ...(overrides[i] ?? {}),
  }));

const uses = (slots) =>
  slots
    .map((slot) => JSON.stringify({ slot, themeId: themeId(CLIENT_LANE_THEME_SLOTS.indexOf(slot)), test: "t" }))
    .join("\n");

const passing = (extra = {}) => ({
  themesText: themesRecord(),
  usesText: uses(["editor"]),
  afterSuite: afterSuite(),
  workerValue: undefined,
  expected,
  ...extra,
});

describe("the fixture", () => {
  test("is Starter 31's, one digest per path", () => {
    assert.ok(expected.length > 0);
    assert.equal(new Set(expected.map((file) => file.path)).size, expected.length);
    assert.ok(expected.some((file) => file.path === "src/morph/content.ts"));
  });

  test("another Starter version, or a path named twice, is refused", () => {
    assert.throws(
      () => fixtureFileDigests(JSON.stringify({ starterVersion: 32, files: [] })),
      /CLIENT_LANE_FIXTURE: .* records Starter 32, not 31/,
    );
    const file = { path: "a.ts", content: "x", mimeType: "text/typescript", encoding: "utf8", isEntry: false };
    assert.throws(
      () => fixtureFileDigests(JSON.stringify({ starterVersion: 31, files: [file, file] })),
      /names a\.ts twice/,
    );
  });
});

describe("a seeded Theme", () => {
  test("on Starter 31 with no runtime passes", () => {
    assert.equal(clientLaneThemeRefusal(seededTheme(0), expected), null);
  });

  test("every way off the lane is named", () => {
    const cases = [
      [{ previewRuntime: "start" }, /records preview runtime "start"; the lane needs none/],
      [{ framework: "astro" }, /records framework "astro"/],
      [{ starterTemplateVersion: 32 }, /records Starter 32, not 31/],
      [{ rows: 0 }, /0 rows in storefront_themes, not one/],
      [{ rowStorefrontId: "other" }, /belongs to storefront "other"/],
      [{ deletedAt: "2026-01-01" }, /is deleted/],
    ];
    for (const [change, pattern] of cases) {
      assert.match(clientLaneThemeRefusal({ ...seededTheme(0), ...change }, expected), pattern);
    }
  });

  test("an extra, a missing or a changed file is named", () => {
    const theme = seededTheme(0);
    const extra = { ...theme, files: [...theme.files, { path: "src/routes/v32.tsx", mimeType: "text/typescript", encoding: "utf8", isEntry: false, sha256: contentSha256("x") }] };
    assert.match(clientLaneThemeRefusal(extra, expected), /holds files Starter 31 does not: src\/routes\/v32\.tsx/);
    const missing = { ...theme, files: theme.files.filter((file) => file.path !== "src/morph/content.ts") };
    assert.match(clientLaneThemeRefusal(missing, expected), /lacks files of Starter 31: src\/morph\/content\.ts/);
    const changed = { ...theme, files: theme.files.map((file) => (file.path === "package.json" ? { ...file, sha256: contentSha256("{}") } : file)) };
    assert.match(clientLaneThemeRefusal(changed, expected), /package\.json: sha256/);
    const entry = { ...theme, files: theme.files.map((file) => (file.path === "src/routes/index.tsx" ? { ...file, isEntry: false } : file)) };
    assert.match(clientLaneThemeRefusal(entry, expected), /src\/routes\/index\.tsx: isEntry false, not true/);
  });

  test("a missing or doubled template is named", () => {
    const theme = seededTheme(0);
    assert.match(
      clientLaneThemeRefusal({ ...theme, templates: theme.templates.filter((t) => t.type !== "product") }, expected),
      /0 product templates, not one/,
    );
    assert.match(
      clientLaneThemeRefusal({ ...theme, templates: [...theme.templates, { id: "x", type: "layout", routePath: null }] }, expected),
      /2 layout templates, not one/,
    );
  });
});

describe("which runs are the client lane", () => {
  test("client specs, no record mode, the sidecar", () => {
    assert.equal(isClientLaneRun({ runtime: "client" }, undefined, true), true);
    assert.equal(isClientLaneRun({ runtime: "start" }, undefined, true), false);
    assert.equal(isClientLaneRun({ runtime: "client" }, { value: "start" }, true), false);
    assert.equal(isClientLaneRun({ runtime: "client" }, undefined, false), false);
  });

  test("requiring the lane refuses a run off it, and a malformed requirement", () => {
    const on = { [REQUIRE_CLIENT_LANE_VAR]: "1" };
    assert.equal(requiredClientLaneRefusal({}, { runtime: "start" }, undefined, true), null);
    assert.equal(requiredClientLaneRefusal(on, { runtime: "client" }, undefined, true), null);
    assert.match(requiredClientLaneRefusal(on, { runtime: "start" }, undefined, true), /^CLIENT_LANE_REQUIRED: .*start preview/);
    assert.match(requiredClientLaneRefusal(on, { runtime: "client" }, undefined, false), /container transport/);
    assert.match(requiredClientLaneRefusal({ [REQUIRE_CLIENT_LANE_VAR]: "yes" }, { runtime: "client" }, undefined, true), /"yes"; it is "1" or unset/);
  });
});

describe("a run's evidence", () => {
  test("every slot seeded on Starter 31 and still client after the suite passes", () => {
    assert.equal(clientLaneEvidenceRefusal(passing()), null);
    assert.equal(clientLaneEvidenceRefusal(passing({ usesText: undefined })), null);
  });

  test("no Themes file, or not JSON, is a refusal", () => {
    assert.match(clientLaneEvidenceRefusal(passing({ themesText: undefined })), /left no client-lane-themes\.json/);
    assert.match(clientLaneEvidenceRefusal(passing({ themesText: "{" })), /is not JSON/);
    assert.match(
      clientLaneEvidenceRefusal(passing({ themesText: JSON.stringify({ version: 1, starterVersion: 32, themes: [] }) })),
      /not a version 1 record of Starter 31 Themes/,
    );
  });

  test("a slot not seeded, seeded twice, or unknown is a refusal", () => {
    assert.match(
      clientLaneEvidenceRefusal(passing({ themesText: themesRecord((themes) => themes.slice(1)) })),
      /slot editor was not seeded/,
    );
    assert.match(
      clientLaneEvidenceRefusal(passing({ themesText: themesRecord((themes) => [...themes, themes[0]]) })),
      /slot editor was seeded twice/,
    );
    assert.match(
      clientLaneEvidenceRefusal(passing({ themesText: themesRecord((themes) => [...themes, { ...themes[0], slot: "other" }]) })),
      /unknown slot "other"/,
    );
  });

  test("a Theme seeded off Starter 31 is a refusal, even when the run itself said ok", () => {
    const text = themesRecord((themes) => {
      themes[2].seeded.previewRuntime = "start";
      return themes;
    });
    assert.match(
      clientLaneEvidenceRefusal(passing({ themesText: text })),
      /slot selection-field\/adopting before the suite: CLIENT_LANE_THEME_NOT_STARTER_31: .*records preview runtime "start"/,
    );
  });

  test("an editor path that does not open the Theme's own index template is a refusal", () => {
    const text = themesRecord((themes) => {
      themes[0].editorPath = themes[1].editorPath;
      return themes;
    });
    assert.match(clientLaneEvidenceRefusal(passing({ themesText: text })), /slot editor: its editor path does not open its own index template/);
  });

  test("a Theme that records a runtime after the suite, or is gone, is a refusal", () => {
    assert.match(
      clientLaneEvidenceRefusal(passing({ afterSuite: afterSuite({ 0: { previewRuntime: "start" } }) })),
      /slot editor: after the suite Theme .* records "start", which the Worker .* serves as start/,
    );
    assert.match(
      clientLaneEvidenceRefusal(passing({ afterSuite: afterSuite({ 1: { rows: 0 } }) })),
      /slot selection-field\/typing: Theme .* was not read back after the suite/,
    );
  });

  test("a Worker serving Start by default is a refusal: the record alone does not make a Theme client", () => {
    assert.match(
      clientLaneEvidenceRefusal(passing({ workerValue: "start" })),
      /MORPH_THEME_PREVIEW_RUNTIME="start"\) serves as start/,
    );
  });

  test("a use that took another Theme for its slot, or names no slot, is a refusal", () => {
    assert.match(
      clientLaneEvidenceRefusal(passing({ usesText: JSON.stringify({ slot: "editor", themeId: themeId(3) }) })),
      /use 1 took Theme .* for slot editor, not its seeded/,
    );
    assert.match(clientLaneEvidenceRefusal(passing({ usesText: "nope" })), /use 1 names no seeded slot/);
  });
});

describe("the acceptance check across shards", () => {
  let root;
  before(async () => {
    root = await mkdtemp(path.join(tmpdir(), "client-lane-verdicts-"));
  });
  after(async () => {
    await rm(root, { recursive: true, force: true });
  });

  async function shards(name, verdictFor, count = 6) {
    const dir = path.join(root, name);
    const files = [];
    for (let shard = 1; shard <= count; shard += 1) {
      const artifact = path.join(dir, `editor-e2e-results-${shard}-attempt-1`);
      await mkdir(artifact, { recursive: true });
      const verdict = verdictFor(shard);
      if (verdict === null) continue;
      const file = path.join(artifact, `shard-${shard}.json.client-lane.json`);
      await writeFile(file, typeof verdict === "string" ? verdict : JSON.stringify(verdict));
      files.push(file);
    }
    return files;
  }

  // Each slot taken by some shard, as the migrated specs spread over shards.
  const slotsOf = (shard) => CLIENT_LANE_THEME_SLOTS.filter((_, i) => i % 6 === shard - 1);

  test("six ok verdicts whose evidence passes again, every slot taken, pass", async () => {
    const files = await shards("pass", (shard) => clientLaneVerdict(passing({ usesText: uses(slotsOf(shard)) })));
    assert.equal(clientLaneVerdictsRefusal(files, expected), null);
  });

  test("a missing verdict is a refusal", async () => {
    const files = await shards("missing", (shard) => (shard === 4 ? null : clientLaneVerdict(passing({ usesText: uses(slotsOf(shard)) }))));
    assert.match(clientLaneVerdictsRefusal(files, expected), /shard 4: 0 shard-4\.json\.client-lane\.json/);
  });

  test("a verdict saying ok whose evidence fails again is a refusal", async () => {
    const files = await shards("forged", (shard) => {
      const verdict = clientLaneVerdict(passing({ usesText: uses(slotsOf(shard)) }));
      return shard === 2 ? { ...verdict, afterSuite: afterSuite({ 0: { previewRuntime: "start" } }) } : verdict;
    });
    assert.match(clientLaneVerdictsRefusal(files, expected), /shard 2: CLIENT_LANE_UNVERIFIED/);
  });

  test("a slot no shard's specs took is a refusal", async () => {
    const files = await shards("unused", (shard) =>
      clientLaneVerdict(passing({ usesText: uses(slotsOf(shard).filter((slot) => slot !== "selection-field/return-paths")) })),
    );
    assert.match(clientLaneVerdictsRefusal(files, expected), /no shard's specs took the dedicated Theme of selection-field\/return-paths/);
  });

  test("evidence checked against another fixture is a refusal", async () => {
    const files = await shards("fixture", (shard) => clientLaneVerdict(passing({ usesText: uses(slotsOf(shard)) })));
    const other = expected.map((file) => (file.path === "src/morph/content.ts" ? { ...file, sha256: contentSha256("other") } : file));
    assert.match(clientLaneVerdictsRefusal(files, other), /src\/morph\/content\.ts: sha256/);
  });

  test("the fixture the guard reads is the checkout's", async () => {
    const text = await readFile(CLIENT_LANE_STARTER_FIXTURE, "utf8");
    assert.deepEqual(fixtureFileDigests(text), expected);
  });
});
