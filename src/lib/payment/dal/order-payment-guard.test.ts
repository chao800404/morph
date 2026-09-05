import Database from "better-sqlite3";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

/**
 * The payment precondition, exercised against real SQL.
 *
 * Money moves at the provider before the batch runs, so the guard is the only
 * thing standing between a concurrent change and a double capture. It has to
 * fail loudly — `json('')` raises "malformed JSON", which is what aborts the
 * whole D1 batch — rather than silently matching zero rows.
 */
let sqlite: Database.Database;

/** Mirrors `preparePaymentStateGuard`, amount condition included or not. */
const guardSql = (withAmount: boolean) => `
  SELECT CASE WHEN EXISTS (
    SELECT 1
    FROM payment_collections pc
    JOIN payments p ON p.id = @paymentId
    WHERE pc.id = @collectionId
      AND p.canceled_at IS NULL
      ${withAmount ? "AND COALESCE(pc.captured_amount, 0) = @expected" : ""}
  ) THEN 1 ELSE json('') END AS ok
`;

/** True when the guard row evaluates; false when it raises and kills the batch. */
const passes = (withAmount: boolean, expected = 0) => {
  try {
    const row = sqlite.prepare(guardSql(withAmount)).get({
      paymentId: "pay-1",
      collectionId: "col-1",
      ...(withAmount ? { expected } : {}),
    }) as { ok: number };
    return row.ok === 1;
  } catch {
    return false;
  }
};

beforeEach(() => {
  sqlite = new Database(":memory:");
  sqlite.exec(`
    CREATE TABLE payments (id text PRIMARY KEY NOT NULL, canceled_at text);
    CREATE TABLE payment_collections (
      id text PRIMARY KEY NOT NULL,
      captured_amount integer
    );
    INSERT INTO payments (id, canceled_at) VALUES ('pay-1', NULL);
    INSERT INTO payment_collections (id, captured_amount) VALUES ('col-1', 0);
  `);
});

afterEach(() => sqlite.close());

describe("payment state guard", () => {
  it("passes when the payment is live and the amount is unchanged", () => {
    expect(passes(true, 0)).toBe(true);
  });

  // A capture that read `captured_amount = 0` and raced another capture would
  // otherwise overwrite the winner's total and lose one of the two charges.
  it("fails when the captured amount moved under it", () => {
    sqlite.exec("UPDATE payment_collections SET captured_amount = 500");
    expect(passes(true, 0)).toBe(false);
  });

  // Cancellation moves no money, so it carried no amount check at all and
  // would happily cancel a payment another request had already canceled.
  it("fails on a canceled payment even without an amount condition", () => {
    sqlite.exec("UPDATE payments SET canceled_at = '2026-01-01T00:00:00.000Z'");
    expect(passes(false)).toBe(false);
    expect(passes(true, 0)).toBe(false);
  });

  it("aborts the statement rather than returning a falsy row", () => {
    sqlite.exec("UPDATE payments SET canceled_at = '2026-01-01T00:00:00.000Z'");
    expect(() =>
      sqlite
        .prepare(guardSql(false))
        .get({ paymentId: "pay-1", collectionId: "col-1" }),
    ).toThrow(/malformed JSON/);
  });
});
