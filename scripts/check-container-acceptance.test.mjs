// @ts-check
import assert from "node:assert/strict";
import test from "node:test";
import { execFileSync } from "node:child_process";
import {
  existsSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  verifyContainerReport,
  verifyContainerTitles,
} from "./check-container-acceptance.mjs";

test("check-container-acceptance", async (t) => {
  await t.test(
    "passes on a valid report where the target spec passed with zero skip and zero retry",
    () => {
      const report = {
        suites: [
          {
            file: "e2e/m1-container-lifecycle-acceptance.spec.ts",
            specs: [
              {
                file: "e2e/m1-container-lifecycle-acceptance.spec.ts",
                title: "M1 lifecycle",
                tests: [
                  {
                    projectName: "editor",
                    status: "expected",
                    results: [{ status: "passed" }],
                  },
                ],
              },
            ],
          },
        ],
        stats: {
          expected: 1,
          unexpected: 0,
          flaky: 0,
          skipped: 0,
        },
      };

      const result = verifyContainerReport(report);
      assert.equal(result.passedCount, 1);
    },
  );

  await t.test(
    "fails if the report only contains setup or other specs but not the target spec",
    () => {
      const report = {
        suites: [
          {
            file: "e2e/auth.setup.ts",
            specs: [
              {
                file: "e2e/auth.setup.ts",
                title: "setup",
                tests: [
                  {
                    projectName: "editor",
                    status: "expected",
                    results: [{ status: "passed" }],
                  },
                ],
              },
            ],
          },
        ],
        stats: {
          expected: 1,
          unexpected: 0,
          flaky: 0,
          skipped: 0,
        },
      };

      assert.throws(
        () => verifyContainerReport(report),
        /CONTAINER_ACCEPTANCE_SPEC_MISSING/,
      );
    },
  );

  await t.test(
    "fails if the target spec skipped (e.g. environment skip)",
    () => {
      const report = {
        suites: [
          {
            file: "e2e/m1-container-lifecycle-acceptance.spec.ts",
            specs: [
              {
                file: "e2e/m1-container-lifecycle-acceptance.spec.ts",
                title: "M1 lifecycle",
                tests: [
                  {
                    projectName: "editor",
                    status: "skipped",
                    results: [{ status: "skipped" }],
                  },
                ],
              },
            ],
          },
        ],
        stats: {
          expected: 0,
          unexpected: 0,
          flaky: 0,
          skipped: 1,
        },
      };

      assert.throws(
        () => verifyContainerReport(report),
        /CONTAINER_ACCEPTANCE_SKIPPED/,
      );
    },
  );

  await t.test("fails if the target spec had retries", () => {
    const report = {
      suites: [
        {
          file: "e2e/m1-container-lifecycle-acceptance.spec.ts",
          specs: [
            {
              file: "e2e/m1-container-lifecycle-acceptance.spec.ts",
              title: "M1 lifecycle",
              tests: [
                {
                  projectName: "editor",
                  status: "flaky",
                  results: [{ status: "failed" }, { status: "passed" }],
                },
              ],
            },
          ],
        },
      ],
      stats: {
        expected: 0,
        unexpected: 0,
        flaky: 1,
        skipped: 0,
      },
    };

    assert.throws(
      () => verifyContainerReport(report),
      /CONTAINER_ACCEPTANCE_RETRY_DETECTED/,
    );
  });

  await t.test("fails if the target spec failed", () => {
    const report = {
      suites: [
        {
          file: "e2e/m1-container-lifecycle-acceptance.spec.ts",
          specs: [
            {
              file: "e2e/m1-container-lifecycle-acceptance.spec.ts",
              title: "M1 lifecycle",
              tests: [
                {
                  projectName: "editor",
                  status: "unexpected",
                  results: [{ status: "failed" }],
                },
              ],
            },
          ],
        },
      ],
      stats: {
        expected: 0,
        unexpected: 1,
        flaky: 0,
        skipped: 0,
      },
    };

    assert.throws(
      () => verifyContainerReport(report),
      /CONTAINER_ACCEPTANCE_FAILED/,
    );
  });
});

/**
 * A Playwright JSON report shaped as the reporter writes it: one top-level
 * suite per file, one nested suite per describe, specs at the leaves.
 * @param {Array<{file: string, path: string[], project?: string, results: Array<{status: string, retry?: number}>}>} entries
 */
function reportOf(entries) {
  /** @type {any[]} */
  const suites = [];
  for (const entry of entries) {
    let suite = suites.find((s) => s.file === entry.file);
    if (!suite) {
      suite = { title: entry.file, file: entry.file, specs: [], suites: [] };
      suites.push(suite);
    }
    for (const title of entry.path.slice(0, -1)) {
      let child = suite.suites.find(
        (/** @type {any} */ s) => s.title === title,
      );
      if (!child) {
        child = { title, file: entry.file, specs: [], suites: [] };
        suite.suites.push(child);
      }
      suite = child;
    }
    suite.specs.push({
      title: entry.path.at(-1),
      file: entry.file,
      tests: [
        {
          projectName: entry.project ?? "editor",
          results: entry.results.map((r, index) => ({ retry: index, ...r })),
        },
      ],
    });
  }
  return { suites, stats: { unexpected: 0, flaky: 0 } };
}

const SETUP = {
  file: "auth.setup.ts",
  path: ["authenticate"],
  project: "setup",
  results: [{ status: "passed" }],
};
const PRECONDITION = {
  file: "preview-transport.spec.ts",
  path: ["the preview comes from the expected transport"],
  project: "preview-transport",
  results: [{ status: "passed" }],
};

// Every target a container step checks gets the same cases, so a new target
// module is covered by adding it. The fixture runs them before any module
// exists; it names no spec, so only it skips the source check.
const FIXTURE = {
  file: "fixture-acceptance.spec.ts",
  titles: ["Fixture flow › first step", "Fixture flow › second step"],
};
const TARGETS_DIR = new URL("./container-acceptance-targets/", import.meta.url);
const MODULES = existsSync(TARGETS_DIR)
  ? await Promise.all(
      readdirSync(TARGETS_DIR)
        .filter((name) => name.endsWith(".mjs"))
        .sort()
        .map(async (name) => {
          const { TARGET } = await import(new URL(name, TARGETS_DIR).href);
          return /** @type {const} */ ([name, TARGET, true]);
        }),
    )
  : [];
const TARGETS = [
  /** @type {const} */ (["fixture", FIXTURE, false]),
  ...MODULES,
];

for (const [name, target, inSpec] of TARGETS) {
  /** @type {readonly string[]} */
  const titles = target.titles;
  const cell = (/** @type {string} */ title) => ({
    file: target.file,
    path: title.split(" › "),
    results: [{ status: "passed" }],
  });
  // The test each case breaks; a one-title target breaks its only test.
  const second = titles[titles.length > 1 ? 1 : 0];
  const others = titles.filter((title) => title !== second);
  const first = titles[0];
  /** @param {string} code @param {string} [title] */
  const failsWith = (code, title) => (/** @type {unknown} */ error) =>
    error instanceof Error &&
    error.message.includes(code) &&
    (title === undefined || error.message.includes(title));

  test(`container acceptance by full title: ${name}`, async (t) => {
    assert.ok(titles.length >= 1, `${name} lists no title`);

    await t.test(
      "passes when every listed test passed once, setup and precondition alongside",
      () => {
        const report = reportOf([SETUP, PRECONDITION, ...titles.map(cell)]);
        assert.deepEqual(verifyContainerTitles(report, target), {
          passedCount: titles.length,
        });
      },
    );

    await t.test(
      "fails naming a missing test; setup tests do not count toward the list",
      () => {
        const report = reportOf([
          SETUP,
          { ...SETUP, path: ["authenticate again"] },
          PRECONDITION,
          ...others.map(cell),
        ]);
        assert.throws(
          () => verifyContainerTitles(report, target),
          failsWith("CONTAINER_ACCEPTANCE_MISSING", second),
        );
      },
    );

    await t.test("fails naming a duplicated test", () => {
      const report = reportOf([...titles.map(cell), cell(second)]);
      assert.throws(
        () => verifyContainerTitles(report, target),
        failsWith("CONTAINER_ACCEPTANCE_DUPLICATE", second),
      );
    });

    await t.test("fails naming a skipped test", () => {
      const report = reportOf([
        ...others.map(cell),
        { ...cell(second), results: [{ status: "skipped" }] },
      ]);
      assert.throws(
        () => verifyContainerTitles(report, target),
        failsWith("CONTAINER_ACCEPTANCE_SKIPPED", second),
      );
    });

    await t.test(
      "fails naming a retried test, also when only the retry's result is kept",
      () => {
        for (const results of [
          [{ status: "failed" }, { status: "passed" }],
          [{ status: "passed", retry: 1 }],
        ]) {
          const report = reportOf([
            ...others.map(cell),
            { ...cell(second), results },
          ]);
          assert.throws(
            () => verifyContainerTitles(report, target),
            failsWith("CONTAINER_ACCEPTANCE_RETRY_DETECTED", second),
          );
        }
      },
    );

    await t.test("fails naming a failed, timed-out or interrupted test", () => {
      for (const status of ["failed", "timedOut", "interrupted"]) {
        const report = reportOf([
          ...others.map(cell),
          { ...cell(second), results: [{ status }] },
        ]);
        assert.throws(
          () => verifyContainerTitles(report, target),
          failsWith("CONTAINER_ACCEPTANCE_FAILED", second),
        );
      }
    });

    await t.test("fails on an unlisted test of the same file", () => {
      const describes = first.split(" › ").slice(0, -1);
      const report = reportOf([
        ...titles.map(cell),
        cell([...describes, "an unlisted test"].join(" › ")),
      ]);
      assert.throws(
        () => verifyContainerTitles(report, target),
        failsWith("CONTAINER_ACCEPTANCE_UNLISTED"),
      );
    });

    await t.test("matches the describe path, not the leaf title alone", () => {
      const leaf = second.split(" › ").at(-1) ?? "";
      assert.notEqual(
        leaf,
        second,
        `${name}: titles must carry their describe path`,
      );
      const report = reportOf([...others.map(cell), cell(leaf)]);
      assert.throws(
        () => verifyContainerTitles(report, target),
        failsWith("CONTAINER_ACCEPTANCE_UNLISTED"),
      );
    });

    await t.test("fails when the target file ran in another project", () => {
      const report = reportOf([
        ...titles.map(cell),
        { ...cell(first), project: "editor-firefox" },
      ]);
      assert.throws(
        () => verifyContainerTitles(report, target),
        failsWith("CONTAINER_ACCEPTANCE_WRONG_PROJECT"),
      );
    });

    await t.test(
      "the lifecycle call still accepts and refuses what it did",
      () => {
        const lifecycle = reportOf([
          SETUP,
          {
            file: "m1-container-lifecycle-acceptance.spec.ts",
            path: ["M1 lifecycle"],
            results: [{ status: "passed" }],
          },
        ]);
        assert.deepEqual(verifyContainerReport(lifecycle), { passedCount: 1 });
        // This target's report does not satisfy the lifecycle gate.
        assert.throws(
          () => verifyContainerReport(reportOf(titles.map(cell))),
          /CONTAINER_ACCEPTANCE_SPEC_MISSING/,
        );
      },
    );

    await t.test(
      "every listed title is a describe path and test title in the spec",
      { skip: !inSpec },
      () => {
        const source = readFileSync(
          new URL(`../e2e/${target.file}`, import.meta.url),
          "utf8",
        );
        for (const title of titles) {
          const parts = title.split(" › ");
          for (const describe of parts.slice(0, -1)) {
            assert.ok(
              source.includes(`test.describe(${JSON.stringify(describe)}`),
              `${target.file} has no describe ${JSON.stringify(describe)}`,
            );
          }
          assert.ok(
            source.includes(`test(${JSON.stringify(parts.at(-1))}`),
            `${target.file} has no test ${JSON.stringify(parts.at(-1))}`,
          );
        }
      },
    );
  });
}

test("the command line dispatches on its second argument", async (t) => {
  const script = fileURLToPath(
    new URL("./check-container-acceptance.mjs", import.meta.url),
  );
  const dir = mkdtempSync(path.join(tmpdir(), "container-acceptance-cli-"));
  const write = (/** @type {string} */ name, /** @type {unknown} */ value) => {
    const file = path.join(dir, name);
    writeFileSync(
      file,
      typeof value === "string" ? value : JSON.stringify(value),
    );
    return file;
  };
  const run = (/** @type {string[]} */ args) => {
    try {
      return {
        code: 0,
        out: execFileSync(process.execPath, [script, ...args], {
          encoding: "utf8",
          stdio: "pipe",
        }),
      };
    } catch (/** @type {any} */ error) {
      return { code: error.status, out: String(error.stderr) };
    }
  };
  const lifecycle = write(
    "lifecycle.json",
    reportOf([
      SETUP,
      {
        file: "m1-container-lifecycle-acceptance.spec.ts",
        path: ["M1 lifecycle"],
        results: [{ status: "passed" }],
      },
    ]),
  );
  const fixture = write(
    "fixture.json",
    reportOf(
      FIXTURE.titles.map((title) => ({
        file: FIXTURE.file,
        path: title.split(" › "),
        results: [{ status: "passed" }],
      })),
    ),
  );
  const target = write(
    "fixture-target.mjs",
    `export const TARGET = ${JSON.stringify(FIXTURE)};`,
  );
  const shorter = write(
    "shorter-target.mjs",
    `export const TARGET = ${JSON.stringify({ ...FIXTURE, titles: FIXTURE.titles.slice(0, 1) })};`,
  );

  await t.test("no second argument checks the lifecycle spec", () => {
    assert.equal(run([lifecycle]).code, 0);
    assert.notEqual(run([fixture]).code, 0);
  });
  await t.test(
    "a spec file checks every test of that file (compatibility mode)",
    () => {
      assert.equal(run([fixture, FIXTURE.file]).code, 0);
      assert.match(
        run([lifecycle, FIXTURE.file]).out,
        /CONTAINER_ACCEPTANCE_SPEC_MISSING/,
      );
    },
  );
  await t.test("a .mjs target module checks the exact list", () => {
    assert.equal(run([fixture, target]).code, 0);
    assert.match(run([fixture, shorter]).out, /CONTAINER_ACCEPTANCE_UNLISTED/);
  });
});
