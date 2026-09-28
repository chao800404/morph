import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { getDb } from "@/db";
import { hashInviteToken } from "@/lib/invite/token";
import { orderTransferDal } from "./order-transfer.dal";

let sqlite: Database.Database;
let beforeBatch: (() => void) | undefined;

vi.mock("@/db", () => ({ getDb: vi.fn() }));
vi.mock("cloudflare:workers", () => ({
  env: {
    DATABASE: {
      prepare: (query: string) => ({
        bind: (...values: unknown[]) => ({
          run: () => {
            const result = sqlite
              .prepare(query)
              .run(
                Object.fromEntries(
                  values.map((value, index) => [String(index + 1), value]),
                ),
              );
            return { meta: { changes: result.changes } };
          },
        }),
      }),
      batch: async (statements: Array<{ run: () => unknown }>) => {
        beforeBatch?.();
        beforeBatch = undefined;
        return sqlite.transaction(() =>
          statements.map((statement) => statement.run()),
        )();
      },
    },
  },
}));

const recipientEmail = "guest@example.com";
const targetEmail = "account@example.com";
const now = "2026-09-27T10:00:00.000Z";

beforeEach(() => {
  beforeBatch = undefined;
  sqlite = new Database(":memory:");
  sqlite.exec(`
    CREATE TABLE customers (
      id TEXT PRIMARY KEY,
      email TEXT,
      has_account INTEGER NOT NULL,
      deleted_at TEXT
    );
    CREATE TABLE orders (
      id TEXT PRIMARY KEY,
      display_id INTEGER NOT NULL,
      customer_id TEXT,
      sales_channel_id TEXT,
      email TEXT,
      is_draft_order INTEGER NOT NULL,
      canceled_at TEXT,
      status TEXT NOT NULL,
      deleted_at TEXT,
      updated_at TEXT
    );
  `);
  sqlite.exec(
    readFileSync(
      resolve(process.cwd(), "drizzle/0065_order_transfers.sql"),
      "utf8",
    ),
  );
  sqlite.exec(
    readFileSync(
      resolve(process.cwd(), "drizzle/0066_order_transfer_request_details.sql"),
      "utf8",
    ),
  );
  sqlite.exec(
    "INSERT INTO customers VALUES ('guest','guest@example.com',0,NULL)",
  );
  sqlite.exec(
    "INSERT INTO customers VALUES ('account','account@example.com',1,NULL)",
  );
  seedOrder();
  sqlite.exec(
    "INSERT INTO orders VALUES ('owned',102,'account','store','account@example.com',0,NULL,'completed',NULL,NULL)",
  );
  sqlite.exec(
    "INSERT INTO customers VALUES ('other','other@example.com',1,NULL)",
  );
  sqlite.exec(
    "INSERT INTO orders VALUES ('order-other',101,'other','store','other@example.com',0,NULL,'completed',NULL,NULL)",
  );

  vi.mocked(getDb).mockResolvedValue(drizzle(sqlite) as never);
});

afterEach(() => sqlite.close());

describe("order transfer DAL", () => {
  it("requests a guest-order transfer to a different verified account", async () => {
    const result = await orderTransferDal.request({
      orderId: "guest-order",
      customerId: "account",
      userId: "user-account",
      email: targetEmail,
      description: "This was my guest checkout.",
      updateOrderEmail: true,
      salesChannelId: "store",
      now,
    });

    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.orderEmail).toBe(recipientEmail);
    expect(result.targetEmail).toBe(targetEmail);
    expect(result.description).toBe("This was my guest checkout.");
    const transfer = sqlite
      .prepare(
        "SELECT email, target_email, description, update_order_email, token_hash, status FROM order_transfers WHERE id=?",
      )
      .get(result.transferId) as Record<string, unknown>;
    expect(transfer).toMatchObject({
      email: recipientEmail,
      target_email: targetEmail,
      description: "This was my guest checkout.",
      update_order_email: 1,
      status: "pending",
    });
    expect(transfer.token_hash).toBe(await hashInviteToken(result.token));
    expect(transfer.token_hash).not.toBe(result.token);
  });

  it("does not allow transfer requests for orders already owned by an account", async () => {
    const result = await orderTransferDal.request({
      orderId: "owned",
      customerId: "other",
      userId: "user-other",
      email: "other@example.com",
      description: null,
      updateOrderEmail: false,
      salesChannelId: "store",
      now,
    });
    expect(result).toEqual({ success: false, reason: "NOT_FOUND" });
  });

  it("accepts the emailed token and transfers ownership without changing email by default", async () => {
    const request = await createRequest(false);
    expect(
      await orderTransferDal.accept({
        orderId: "guest-order",
        salesChannelId: "store",
        token: request.token,
        now,
      }),
    ).toBe(true);
    expect(order("guest-order")).toMatchObject({
      customer_id: "account",
      email: recipientEmail,
    });
    expect(transferStatus(request.transferId)).toBe("accepted");
  });

  it("can update the order email to the target account email on acceptance", async () => {
    const request = await createRequest(true);
    expect(
      await orderTransferDal.accept({
        orderId: "guest-order",
        salesChannelId: "store",
        token: request.token,
        now,
      }),
    ).toBe(true);
    expect(order("guest-order")).toMatchObject({
      customer_id: "account",
      email: targetEmail,
    });
  });

  it("rejects a wrong token without changing the order or request", async () => {
    const request = await createRequest(false);
    expect(
      await orderTransferDal.accept({
        orderId: "guest-order",
        salesChannelId: "store",
        token: "f".repeat(64),
        now,
      }),
    ).toBe(false);
    expect(order("guest-order").customer_id).toBe("guest");
    expect(transferStatus(request.transferId)).toBe("pending");
  });

  it("invalidates acceptance if the target account email changes after the request", async () => {
    const request = await createRequest(false);
    sqlite
      .prepare(
        "UPDATE customers SET email='changed@example.com' WHERE id='account'",
      )
      .run();
    expect(
      await orderTransferDal.accept({
        orderId: "guest-order",
        salesChannelId: "store",
        token: request.token,
        now,
      }),
    ).toBe(false);
    expect(order("guest-order").customer_id).toBe("guest");
    expect(transferStatus(request.transferId)).toBe("pending");
  });

  it("rolls back the transfer if the order owner changed before acceptance", async () => {
    const request = await createRequest(false);
    beforeBatch = () =>
      sqlite
        .prepare("UPDATE orders SET customer_id='other' WHERE id='guest-order'")
        .run();
    expect(
      await orderTransferDal.accept({
        orderId: "guest-order",
        salesChannelId: "store",
        token: request.token,
        now,
      }),
    ).toBe(false);
    expect(order("guest-order").customer_id).toBe("other");
    expect(transferStatus(request.transferId)).toBe("pending");
  });

  it("declines by token and only the authenticated requester can cancel", async () => {
    const request = await createRequest(false);
    expect(
      await orderTransferDal.cancel({
        orderId: "guest-order",
        customerId: "other",
        salesChannelId: "store",
        now,
      }),
    ).toBe(false);
    expect(
      await orderTransferDal.decline({
        orderId: "guest-order",
        salesChannelId: "store",
        token: request.token,
        now,
      }),
    ).toBe(true);
    expect(transferStatus(request.transferId)).toBe("declined");

    const cancellableRequest = await createRequest(false);
    expect(
      await orderTransferDal.cancel({
        orderId: "guest-order",
        customerId: "account",
        salesChannelId: "store",
        now,
      }),
    ).toBe(true);
    expect(transferStatus(cancellableRequest.transferId)).toBe("canceled");
  });
});

const seedOrder = () =>
  sqlite.exec(
    "INSERT INTO orders VALUES ('guest-order',100,'guest','store','guest@example.com',0,NULL,'completed',NULL,NULL)",
  );

const createRequest = async (updateOrderEmail: boolean) => {
  const result = await orderTransferDal.request({
    orderId: "guest-order",
    customerId: "account",
    userId: "user-account",
    email: targetEmail,
    description: null,
    updateOrderEmail,
    salesChannelId: "store",
    now,
  });
  if (!result.success) throw new Error("Order transfer request was rejected");
  return result;
};

const order = (id: string) =>
  sqlite
    .prepare("SELECT customer_id, email FROM orders WHERE id=?")
    .get(id) as { customer_id: string; email: string };

const transferStatus = (id: string) =>
  (
    sqlite.prepare("SELECT status FROM order_transfers WHERE id=?").get(id) as {
      status: string;
    }
  ).status;
