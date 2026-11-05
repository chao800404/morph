// @ts-check
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import {
  CI_RULE_PATHS,
  NOT_CI_RULES,
  ciRulesReport,
  isRulePath,
  parseLsTree,
  rulesFingerprint,
  unionRules,
} from "./ci-rules.mjs";

const REPO_ROOT = new URL("../", import.meta.url);
const A = "a".repeat(40);
const B = "b".repeat(40);

test("every listed rule file exists, so a misspelt path cannot drop out silently", () => {
  for (const rule of CI_RULE_PATHS) {
    if (rule.endsWith("/")) continue;
    assert.ok(existsSync(new URL(rule, REPO_ROOT)), `${rule} does not exist`);
  }
  assert.deepEqual(
    [...CI_RULE_PATHS],
    unionRules(CI_RULE_PATHS, []),
    "list is sorted and unique",
  );
});

test("the list covers the checker, its targets and itself", () => {
  for (const file of [
    "scripts/check-container-acceptance.mjs",
    "scripts/container-acceptance-targets/b1-publish-rollback.mjs",
    "scripts/ci-rules.mjs",
    "scripts/ci-required-checks.mjs",
    ".github/workflows/ci.yml",
  ]) {
    assert.ok(isRulePath(file, CI_RULE_PATHS), file);
  }
  for (const file of [
    "scripts/check-container-acceptance.test.mjs",
    "scripts/container-acceptance-targets",
    "scripts/ci-rules.mjs.bak",
    "e2e/m1-container-lifecycle-acceptance.spec.ts",
  ]) {
    assert.ok(!isRulePath(file, CI_RULE_PATHS), file);
  }
});

test("unionRules keeps both lists and refuses a non-path", () => {
  assert.deepEqual(unionRules(["b", "a/"], ["c", "a/"]), ["a/", "b", "c"]);
  for (const bad of ["", "/etc/passwd", 7, null]) {
    assert.throws(() => unionRules([], [bad]), /invalid rule path/);
  }
});

test("the fingerprint is order-independent and moves with every file change", () => {
  const base = [
    { path: "x/one.mjs", blob: A },
    { path: "x/two.mjs", blob: B },
  ];
  const fp = rulesFingerprint(base);
  assert.equal(rulesFingerprint([...base].reverse()), fp);
  assert.notEqual(rulesFingerprint(base.slice(0, 1)), fp, "removed");
  assert.notEqual(
    rulesFingerprint([...base, { path: "x/three.mjs", blob: A }]),
    fp,
    "added",
  );
  assert.notEqual(
    rulesFingerprint([base[0], { path: "x/renamed.mjs", blob: B }]),
    fp,
    "renamed",
  );
  assert.notEqual(
    rulesFingerprint([base[0], { path: "x/two.mjs", blob: A }]),
    fp,
    "edited",
  );
  assert.throws(() => rulesFingerprint([...base, base[0]]), /listed twice/);
  assert.throws(
    () => rulesFingerprint([{ path: "x", blob: "HEAD" }]),
    /invalid blob/,
  );
});

test("parseLsTree keeps blobs and paths with spaces", () => {
  const out = [
    `100644 blob ${A}\tscripts/a b.mjs`,
    `040000 tree ${B}\tscripts`,
    `160000 commit ${B}\tvendor`,
    "",
  ].join("\0");
  assert.deepEqual(parseLsTree(out), [{ path: "scripts/a b.mjs", blob: A }]);
});

test("ciRulesReport against a real repository", async (t) => {
  const repo = mkdtempSync(path.join(tmpdir(), "ci-rules-"));
  const git = (/** @type {string[]} */ ...args) =>
    execFileSync("git", ["-C", repo, ...args], { encoding: "utf8" }).trim();
  const write = (/** @type {string} */ file, /** @type {string} */ body) => {
    mkdirSync(path.dirname(path.join(repo, file)), { recursive: true });
    writeFileSync(path.join(repo, file), body);
  };
  const commit = (/** @type {string} */ message) => {
    git("add", "-A");
    git(
      "-c",
      "user.email=t@t",
      "-c",
      "user.name=t",
      "commit",
      "-q",
      "-m",
      message,
    );
    return git("rev-parse", "HEAD");
  };
  t.after(() => rmSync(repo, { recursive: true, force: true }));
  git("init", "-q", "-b", "main");
  write(".github/workflows/ci.yml", "jobs: {}\n");
  write(
    "scripts/container-acceptance-targets/a.mjs",
    "export const TARGET = 1;\n",
  );
  write("scripts/other.mjs", "1\n");
  const main = commit("main");
  const report = (
    /** @type {string} */ head,
    /** @type {string[]} */ extraRules = [],
  ) => ciRulesReport({ repo, main, head, extraRules });

  await t.test("a head that touches no rule file needs no approval", () => {
    write("scripts/other.mjs", "2\n");
    const head = commit("other");
    const r = report(head);
    assert.deepEqual(r.changedRules, []);
    assert.equal(r.rulesSha256, report(main).rulesSha256);
    assert.deepEqual(
      r.files.map((f) => f.path),
      [
        ".github/workflows/ci.yml",
        "scripts/container-acceptance-targets/a.mjs",
      ],
    );
    git("reset", "-q", "--hard", main);
  });

  await t.test(
    "renaming a target out of the list is a change on its old path",
    () => {
      git("mv", "scripts/container-acceptance-targets/a.mjs", "scripts/a.mjs");
      const head = commit("rename");
      assert.deepEqual(report(head).changedRules, [
        "scripts/container-acceptance-targets/a.mjs",
      ]);
      assert.notEqual(report(head).rulesSha256, report(main).rulesSha256);
      git("reset", "-q", "--hard", main);
    },
  );

  await t.test("adding or removing a target is a change", () => {
    write(
      "scripts/container-acceptance-targets/b.mjs",
      "export const TARGET = 2;\n",
    );
    const added = commit("add");
    assert.deepEqual(report(added).changedRules, [
      "scripts/container-acceptance-targets/b.mjs",
    ]);
    git("rm", "-q", "scripts/container-acceptance-targets/a.mjs");
    const removed = commit("remove");
    assert.deepEqual(report(removed).changedRules, [
      "scripts/container-acceptance-targets/a.mjs",
      "scripts/container-acceptance-targets/b.mjs",
    ]);
    git("reset", "-q", "--hard", main);
  });

  await t.test(
    "the head's own list is honoured too, so a new rule file counts at once",
    () => {
      write("scripts/new-checker.mjs", "1\n");
      const head = commit("new checker");
      assert.deepEqual(report(head).changedRules, []);
      assert.deepEqual(report(head, ["scripts/new-checker.mjs"]).changedRules, [
        "scripts/new-checker.mjs",
      ]);
      git("reset", "-q", "--hard", main);
    },
  );

  await t.test("refuses an abbreviated sha", () => {
    assert.throws(() => report(main.slice(0, 12)), /not a full sha/);
  });
});

test("importing the module never runs its command line", () => {
  // The merge tools import the head's copy in a child whose arguments end in
  // "ci-rules.mjs"; that must print the list, not the usage text.
  const url = new URL("./ci-rules.mjs", import.meta.url).href;
  const out = execFileSync(
    process.execPath,
    [
      "--input-type=module",
      "-e",
      "const m = await import(process.argv[1]); console.log(JSON.stringify(m.CI_RULE_PATHS));",
      url,
    ],
    { encoding: "utf8" },
  );
  assert.deepEqual(JSON.parse(out), [...CI_RULE_PATHS]);
});

test("every local module a rule file imports is a rule or excluded with a reason", () => {
  const ruleFiles = CI_RULE_PATHS.flatMap((rule) => {
    if (!rule.endsWith("/")) return [rule];
    const dir = new URL(rule, REPO_ROOT);
    return existsSync(dir)
      ? readdirSync(dir).map((name) => `${rule}${name}`)
      : [];
  }).filter((file) => file.endsWith(".mjs"));
  const undecided = [];
  for (const file of ruleFiles) {
    const source = readFileSync(new URL(file, REPO_ROOT), "utf8");
    for (const [, spec] of source.matchAll(/from\s+"(\.{1,2}\/[^"]+)"/g)) {
      const imported = path.posix.normalize(
        path.posix.join(path.posix.dirname(file), spec),
      );
      if (!isRulePath(imported, CI_RULE_PATHS) && !(imported in NOT_CI_RULES)) {
        undecided.push(`${file} imports ${imported}`);
      }
    }
  }
  assert.deepEqual(undecided, []);
  for (const [file, reason] of Object.entries(NOT_CI_RULES)) {
    assert.ok(existsSync(new URL(file, REPO_ROOT)), `${file} does not exist`);
    assert.ok(!isRulePath(file, CI_RULE_PATHS), `${file} is on both lists`);
    assert.ok(reason.length > 20, `${file} needs a reason`);
  }
});
