import { sql, type SQL } from "drizzle-orm";
import type { BatchItem } from "drizzle-orm/batch";

import type { getDb } from "@/db";

type Db = Awaited<ReturnType<typeof getDb>>;

/**
 * A precondition a D1 batch checks before its writes land, and that aborts
 * the whole batch when it does not hold.
 *
 * `holds` is a boolean SQL condition. The statement selects `1` when it holds
 * and evaluates `json('')` when it does not, which D1 rejects as malformed
 * JSON; a batch is one transaction, so every write in it is rolled back.
 *
 * Why a `select`, not `db.run(sql\`SELECT …\`)`: in drizzle-orm 0.45 a raw
 * `db.run(sql)` statement prepares to itself, and the D1 driver's `batch`
 * binds parameters through `prepared.stmt` — which a raw statement does not
 * have. Any raw statement with a bound value therefore throws
 * "Cannot read properties of undefined (reading 'bind')" in a real D1 batch.
 * The fake D1 unit tests run against never reaches that code, so it only ever
 * failed in the running app. A query builder carries its statement, and this
 * one reads from a one-row subquery so the condition is always evaluated.
 *
 * Interpolating a query builder into `holds`: drizzle already wraps it in
 * parentheses, so write `EXISTS ${builder}`, not `EXISTS (${builder})` — the
 * doubled parentheses are a syntax error in D1's SQLite.
 */
export function batchGuard(db: Db, holds: SQL): BatchItem<"sqlite"> {
  return db
    .select({ ok: sql<number>`CASE WHEN ${holds} THEN 1 ELSE json('') END` })
    .from(sql`(SELECT 1)`);
}
