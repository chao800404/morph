import assert from "node:assert/strict";
import { test } from "node:test";
import { readRunD1WithBusyRetry } from "./verify-published-artifact.mjs";

const busy = () =>
  new Error(
    "D1_ERROR: Failed to parse body as JSON, got: Error: internal error; reference = x",
  );
const noSleep = async () => {};

test("a read that meets a busy database is asked again until it answers", async () => {
  let calls = 0;
  const rows = await readRunD1WithBusyRetry(
    "SELECT 1",
    async () => {
      calls += 1;
      if (calls < 3) throw busy();
      return [{ n: 1 }];
    },
    { sleep: noSleep },
  );
  assert.deepEqual(rows, [{ n: 1 }]);
  assert.equal(calls, 3);
});

test("a read still busy after every attempt fails with the database's error", async () => {
  let calls = 0;
  await assert.rejects(
    readRunD1WithBusyRetry(
      "SELECT 1",
      async () => {
        calls += 1;
        throw busy();
      },
      { sleep: noSleep, attempts: 4 },
    ),
    /internal error/,
  );
  assert.equal(calls, 4);
});

test("any other error is not retried", async () => {
  let calls = 0;
  await assert.rejects(
    readRunD1WithBusyRetry(
      "SELECT 1",
      async () => {
        calls += 1;
        throw new Error("no such table: storefront_releases");
      },
      { sleep: noSleep },
    ),
    /no such table/,
  );
  assert.equal(calls, 1);
});

test("a statement that is not a read is never sent twice", async () => {
  for (const sql of [
    "UPDATE storefronts SET name = ?1",
    "INSERT INTO t VALUES (1)",
    "DELETE FROM t",
    "  with x as (select 1) delete from t",
  ]) {
    let calls = 0;
    await assert.rejects(
      readRunD1WithBusyRetry(
        sql,
        async () => {
          calls += 1;
          throw busy();
        },
        { sleep: noSleep },
      ),
      /internal error/,
    );
    assert.equal(calls, 1, sql);
  }
});

test("a read with leading space or a CTE is a read", async () => {
  for (const sql of ["  select 1", "WITH a AS (SELECT 1) SELECT * FROM a"]) {
    let calls = 0;
    await readRunD1WithBusyRetry(
      sql,
      async () => {
        calls += 1;
        if (calls < 2) throw busy();
        return [];
      },
      { sleep: noSleep },
    );
    assert.equal(calls, 2, sql);
  }
});
