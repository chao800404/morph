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
