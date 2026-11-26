// @ts-check
/**
 * Run by `node --test`, beside the script, like check-vitest-shards.test.mjs:
 * vitest collects `src/**`, and this module decides which files a shard runs.
 */
import assert from "node:assert/strict";
import test from "node:test";
import DurationShardSequencer, {
  PLAN_WORKERS,
  assignShards,
  defaultWeight,
  loadDurations,
  planShards,
  selectShardFiles,
} from "./vitest-shard-sequencer.mjs";

const COUNT = 3;
/** Deterministic pseudo-shuffle, so a failure reproduces. */
const shuffled = (items, seed = 7) => {
  const out = [...items];
  let state = seed;
  for (let index = out.length - 1; index > 0; index -= 1) {
    state = (state * 1103515245 + 12345) % 2147483648;
    const other = state % (index + 1);
    [out[index], out[other]] = [out[other], out[index]];
  }
  return out;
};
const DURATIONS = {
  "src/heavy.test.tsx": 500,
  "src/mid-a.test.ts": 120,
  "src/mid-b.test.ts": 110,
  "src/mid-c.test.ts": 100,
  "src/small-a.test.ts": 3,
  "src/small-b.test.ts": 2,
  "src/small-c.test.ts": 1,
  "src/small-d.test.ts": 1,
  "src/zero.test.ts": 0,
};
const ALL = Object.keys(DURATIONS);
const everyShard = (files, durations, count = COUNT) =>
  Array.from({ length: count }, (_, offset) =>
    selectShardFiles(files, durations, offset + 1, count),
  );

test("the shards are disjoint and together complete", () => {
  const shards = everyShard(ALL, DURATIONS);
  assert.deepEqual(shards.flat().sort(), [...ALL].sort());
  assert.equal(new Set(shards.flat()).size, ALL.length);
});

test("the same input gives the same shards, in any input order", () => {
  const expected = everyShard(ALL, DURATIONS).map((files) => [...files].sort());
  for (const seed of [1, 2, 3, 4, 5]) {
    const got = everyShard(shuffled(ALL, seed), DURATIONS).map((files) =>
      [...files].sort(),
    );
    assert.deepEqual(got, expected, `seed ${seed}`);
  }
});

test("a file that cannot be shared sits alone in the shard that finishes first for it", () => {
  const { shardOf, sum, finish } = planShards(DURATIONS, COUNT);
  const heavy = shardOf.get("src/heavy.test.tsx");
  assert.equal(
    [...shardOf].filter(([, shard]) => shard === heavy).length,
    1,
    "the 500 s file is not given company that could be run elsewhere",
  );
  // No shard is modelled to finish after the heavy file's own length.
  assert.equal(Math.max(...finish), 500);
  assert.equal(
    sum.reduce((a, b) => a + b, 0),
    Object.values(DURATIONS).reduce((a, b) => a + b, 0),
  );
});

test("many equal files spread evenly, whatever the worker count", () => {
  const equal = Object.fromEntries(
    Array.from({ length: 36 }, (_, index) => [`src/f${index}.test.ts`, 10]),
  );
  const shards = everyShard(Object.keys(equal), equal);
  assert.deepEqual(
    shards.map((files) => files.length),
    [12, 12, 12],
  );
  assert.ok(PLAN_WORKERS >= 1);
});

test("a file with no recorded duration runs in exactly one shard, the same on every call", () => {
  const files = [...ALL, "src/new-b.test.ts", "src/new-a.test.ts"];
  const first = everyShard(files, DURATIONS);
  assert.deepEqual(first.flat().sort(), [...files].sort());
  assert.equal(new Set(first.flat()).size, files.length);
  const again = everyShard(shuffled(files, 11), DURATIONS);
  assert.deepEqual(
    again.map((shard) => [...shard].sort()),
    first.map((shard) => [...shard].sort()),
  );
  // Planned files keep the shard they have without the new ones.
  const planned = assignShards(ALL, DURATIONS, COUNT);
  const withNew = assignShards(files, DURATIONS, COUNT);
  for (const file of ALL) assert.equal(withNew.get(file), planned.get(file));
});

test("enough new files spread over the shards that have room, not all onto one", () => {
  const news = Array.from(
    { length: 300 },
    (_, index) => `src/n${index}.test.ts`,
  );
  const sizes = everyShard(news, DURATIONS).map((files) => files.length);
  assert.equal(
    sizes.reduce((a, b) => a + b, 0),
    300,
  );
  assert.ok(sizes.filter((n) => n > 0).length >= 2, sizes.join("/"));
});

test("a file in the durations file that is gone adds weight only; no shard runs it", () => {
  const present = ALL.filter((file) => file !== "src/mid-b.test.ts");
  const shards = everyShard(present, DURATIONS);
  assert.deepEqual(shards.flat().sort(), [...present].sort());
});

test("an empty durations file still assigns every file once", () => {
  const files = [
    "src/a.test.ts",
    "src/b.test.ts",
    "src/c.test.ts",
    "src/d.test.ts",
  ];
  const shards = everyShard(files, {});
  assert.deepEqual(shards.flat().sort(), files);
  assert.equal(defaultWeight({}), 1);
});

test("the default weight is the median of the planned durations", () => {
  assert.equal(defaultWeight({ a: 1, b: 9, c: 5 }), 5);
  assert.equal(defaultWeight({ a: 1, b: 3 }), 2);
});

test("a bad shard index or count is refused", () => {
  assert.throws(() => selectShardFiles(ALL, DURATIONS, 0, 3), /INDEX_INVALID/);
  assert.throws(() => selectShardFiles(ALL, DURATIONS, 4, 3), /INDEX_INVALID/);
  assert.throws(() => planShards(DURATIONS, 0), /COUNT_INVALID/);
  assert.throws(() => planShards(DURATIONS, 1.5), /COUNT_INVALID/);
});

test("the committed durations file is valid and plans three non-empty shards", () => {
  const durations = loadDurations();
  const names = Object.keys(durations);
  assert.ok(names.length > 100);
  for (const name of names) {
    assert.match(name, /\.test\.(ts|tsx)$/, name);
    assert.ok(!name.startsWith("/") && !name.includes("\\"), name);
  }
  const { sum, shardOf } = planShards(durations, COUNT);
  assert.equal(shardOf.size, names.length);
  for (let shard = 0; shard < COUNT; shard += 1)
    assert.ok(
      [...shardOf.values()].includes(shard),
      `shard ${shard + 1} must be planned at least one file`,
    );
  assert.ok(sum.every((seconds) => seconds > 0));
  const shards = everyShard(names, durations);
  assert.deepEqual(shards.flat().sort(), [...names].sort());
});

test("the sequencer shards each group's specs by path under the config root", async () => {
  const root = "/work/morph";
  const specs = ALL.map((file) => ({ moduleId: `${root}/${file}` }));
  // Vitest calls shard() once per groupOrder group; the shards must still
  // partition the union.
  const groups = [specs.slice(0, 4), specs.slice(4)];
  /** @type {string[][]} */
  const ran = [[], [], []];
  for (const index of [1, 2, 3]) {
    const sequencer = new DurationShardSequencer(
      /** @type {any} */ ({ config: { root, shard: { index, count: 3 } } }),
    );
    for (const group of groups) {
      const kept = await sequencer.shard(/** @type {any} */ (group));
      ran[index - 1].push(
        ...kept.map((spec) => spec.moduleId.slice(root.length + 1)),
      );
    }
  }
  assert.deepEqual(ran.flat().sort(), [...ALL].sort());
  assert.equal(new Set(ran.flat()).size, ALL.length);
});

// A shard of many tiny files costs more than their test time: every file also
// costs a worker its import, setup and collect.
const MANY_SMALL = {
  "src/big-a.test.tsx": 300,
  "src/big-b.test.tsx": 300,
  "src/big-c.test.tsx": 300,
  ...Object.fromEntries(
    Array.from({ length: 900 }, (_, index) => [`src/t${index}.test.ts`, 0.1]),
  ),
};

test("a per-file overhead moves files between shards that test time alone leaves level", () => {
  // Two shards, one 200 s file and 600 files of 0.1 s. By test time the tiny
  // files are free, so they all go beside nothing heavy; at 1 s of overhead
  // each they are 660 s of worker time, more than the other shard's 200 s.
  const durations = {
    "src/heavy.test.tsx": 200,
    ...Object.fromEntries(
      Array.from({ length: 600 }, (_, index) => [`src/t${index}.test.ts`, 0.1]),
    ),
  };
  const plain = planShards(durations, 2, 0);
  const weighted = planShards(durations, 2, 1);
  assert.deepEqual(
    [...plain.files].sort((a, b) => a - b),
    [1, 600],
  );
  assert.ok(Math.min(...weighted.files) > 10, weighted.files.join("/"));
  assert.ok(
    Math.max(...weighted.finish) - Math.min(...weighted.finish) <= 2,
    weighted.finish.join("/"),
  );
  // `sum` stays test seconds: the overhead is not added to it.
  assert.equal(
    Math.round(weighted.sum.reduce((a, b) => a + b, 0)),
    Math.round(Object.values(durations).reduce((a, b) => a + b, 0)),
  );
});

test("with the overhead, shards stay disjoint, complete and deterministic", () => {
  const names = Object.keys(MANY_SMALL);
  const files = [...names, "src/new-b.test.ts", "src/new-a.test.ts"];
  const shards = Array.from({ length: COUNT }, (_, offset) =>
    selectShardFiles(files, MANY_SMALL, offset + 1, COUNT, undefined, 0.8),
  );
  assert.deepEqual(shards.flat().sort(), [...files].sort());
  assert.equal(new Set(shards.flat()).size, files.length);
  const again = Array.from({ length: COUNT }, (_, offset) =>
    selectShardFiles(
      shuffled(files, 5),
      MANY_SMALL,
      offset + 1,
      COUNT,
      undefined,
      0.8,
    ),
  );
  assert.deepEqual(
    again.map((shard) => [...shard].sort()),
    shards.map((shard) => [...shard].sort()),
  );
});

test("a new file is weighed at the median duration plus the overhead", () => {
  // Three planned files of 10 s onto three shards; the median is 10 s. With
  // 5 s of overhead each weighs 15 s, so a new file (also 15 s) joins the
  // shard with the lowest finish, the lowest index when level.
  const durations = {
    "src/a.test.ts": 10,
    "src/b.test.ts": 10,
    "src/c.test.ts": 10,
  };
  const assigned = assignShards(
    [...Object.keys(durations), "src/new.test.ts"],
    durations,
    COUNT,
    5,
  );
  assert.deepEqual([...assigned.values()].sort(), [1, 1, 2, 3]);
  assert.equal(assigned.get("src/new.test.ts"), 1);
});

test("loadOverhead reads the overhead block, and an absent one is zero", async () => {
  const { mkdtempSync, writeFileSync } = await import("node:fs");
  const { tmpdir } = await import("node:os");
  const { join } = await import("node:path");
  const { loadOverhead } = await import("./vitest-shard-sequencer.mjs");
  const dir = mkdtempSync(join(tmpdir(), "shard-overhead-"));
  const write = (name, value) => {
    const file = join(dir, name);
    writeFileSync(file, JSON.stringify(value));
    return file;
  };
  assert.deepEqual(loadOverhead(write("none.json", { files: {} })), {
    perFileSeconds: 0,
    perShardSeconds: 0,
  });
  assert.deepEqual(
    loadOverhead(
      write("ok.json", {
        overhead: { perFileSeconds: 0.8, perShardSeconds: 90 },
        files: {},
      }),
    ),
    { perFileSeconds: 0.8, perShardSeconds: 90 },
  );
  for (const bad of [
    { perFileSeconds: -1 },
    { perFileSeconds: "1" },
    { perShardSeconds: Number.NaN },
  ])
    assert.throws(
      () => loadOverhead(write("bad.json", { overhead: bad, files: {} })),
      /DURATIONS_INVALID/,
    );
  assert.throws(
    () => loadOverhead(write("arr.json", { overhead: [], files: {} })),
    /DURATIONS_INVALID/,
  );
});

test("the committed durations file carries a positive fitted per-file overhead", async () => {
  const { loadOverhead } = await import("./vitest-shard-sequencer.mjs");
  const { perFileSeconds, perShardSeconds } = loadOverhead();
  assert.ok(perFileSeconds > 0 && perFileSeconds < 10, String(perFileSeconds));
  assert.ok(perShardSeconds >= 0);
  const { finish, files } = planShards(loadDurations(), COUNT, perFileSeconds);
  assert.ok(files.every((count) => count > 0));
  // The three shards are modelled within a few percent of each other.
  assert.ok(
    (Math.max(...finish) - Math.min(...finish)) / Math.max(...finish) < 0.05,
    finish.join("/"),
  );
});

test("fitOverhead recovers the per-file overhead from shard spans", async () => {
  const { fitOverhead, makespan } =
    await import("./rebalance-vitest-shards.mjs");
  const make = (seed, count) => {
    let state = seed;
    return Array.from({ length: count }, () => {
      state = (state * 1103515245 + 12345) % 2147483648;
      return (state % 4000) / 100;
    });
  };
  const shards = [make(1, 40), make(2, 300), make(3, 90), make(4, 700)].map(
    (durations) => ({
      durations,
      span: 60 + makespan(durations.map((d) => d + 1.5)),
    }),
  );
  const fit = fitOverhead([shards]);
  assert.equal(fit.perFileSeconds, 1.5);
  assert.ok(Math.abs(fit.perShardSeconds - 60) < 0.01);
  // Shards of PLAN_WORKERS files or fewer say nothing about per-file cost.
  const tiny = { durations: [500], span: 520 };
  assert.deepEqual(fitOverhead([[...shards, tiny]]), fit);
  assert.throws(() => fitOverhead([[tiny]]), /enough files/);
});
