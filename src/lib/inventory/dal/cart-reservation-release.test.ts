import Database from "better-sqlite3";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

/**
 * The release invariant, exercised against real SQL.
 *
 * Every path that gives stock back must claim the reservation first, so the
 * same hold cannot be released twice however many entry points race.
 */
let sqlite: Database.Database;

const CLAIM = `
  UPDATE reservation_items
  SET deleted_at = ?1, updated_at = ?1
  WHERE id = ?2
    AND deleted_at IS NULL
    AND (?3 IS NULL OR expires_at < ?3)
`;

// The DAL binds `?N` parameters, which better-sqlite3 takes as a named object.
const claim = (id: string, now: string, requireExpiredBefore: string | null) =>
  sqlite.prepare(CLAIM).run({ 1: now, 2: id, 3: requireExpiredBefore })
    .changes > 0;

const release = (qty: number) =>
  sqlite
    .prepare(
      "UPDATE inventory_levels SET reserved_quantity = max(0, reserved_quantity - ?)",
    )
    .run(qty);

const reserved = () =>
  (sqlite.prepare("SELECT reserved_quantity q FROM inventory_levels").get() as {
    q: number;
  }).q;

beforeEach(() => {
  sqlite = new Database(":memory:");
  sqlite.exec(`
    CREATE TABLE reservation_items (
      id text PRIMARY KEY NOT NULL,
      quantity integer NOT NULL,
      expires_at text,
      deleted_at text,
      updated_at text
    );
    CREATE TABLE inventory_levels (reserved_quantity integer NOT NULL);
    INSERT INTO inventory_levels VALUES (8);
    INSERT INTO reservation_items (id, quantity, expires_at)
    VALUES ('r1', 3, '2020-01-01T00:00:00.000Z');
  `);
});

afterEach(() => sqlite.close());

describe("claim-then-release", () => {
  // Two entry points reading the same undeleted row each subtracted its
  // quantity: 8 - 3 - 3 = 2, reporting stock that is genuinely held.
  it("releases a reservation once even when two paths race", () => {
    const now = "2026-01-01T00:00:00.000Z";
    const winners = [claim("r1", now, null), claim("r1", now, null)].filter(
      Boolean,
    );

    expect(winners).toHaveLength(1);
    for (const _ of winners) release(3);
    expect(reserved()).toBe(5);
  });

  // The sweep selects expired rows, then claims. A renewal in between must
  // survive: the claim has to re-assert the reason the row was selected.
  it("does not sweep a reservation that was renewed after selection", () => {
    sqlite
      .prepare("UPDATE reservation_items SET expires_at = ? WHERE id = 'r1'")
      .run("2099-01-01T00:00:00.000Z");

    const now = "2026-01-01T00:00:00.000Z";
    expect(claim("r1", now, now)).toBe(false);
    expect(reserved()).toBe(8);
  });

  it("still sweeps one that is genuinely expired", () => {
    const now = "2026-01-01T00:00:00.000Z";
    expect(claim("r1", now, now)).toBe(true);
    release(3);
    expect(reserved()).toBe(5);
  });
});
