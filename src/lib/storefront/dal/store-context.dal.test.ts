import { beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ getDb: vi.fn(), verify: vi.fn() }));
vi.mock("@/db", () => ({ getDb: mocks.getDb }));
vi.mock("@/lib/api-key/publishable-key", () => ({
  parsePublishableKeyId: () => "key",
  verifyPublishableKey: mocks.verify,
}));
import { storeContextDal } from "./store-context.dal";
function database(results: unknown[][]) {
  const query: Record<string, unknown> = {};
  for (const method of ["from", "where", "innerJoin", "orderBy", "limit"])
    query[method] = vi.fn(() => query);
  query.then = (resolve: (value: unknown) => unknown) =>
    Promise.resolve(results.shift() ?? []).then(resolve);
  return { select: vi.fn(() => query) };
}
describe("catalog context fails closed", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.verify.mockResolvedValue(true);
  });
  it("rejects anonymous context instead of using the default channel", async () => {
    const db = database([]);
    mocks.getDb.mockResolvedValue(db);
    expect(await storeContextDal.resolve({})).toBeNull();
    expect(db.select).not.toHaveBeenCalled();
  });
  it("allows catalog browsing without a region but still rejects checkout context", async () => {
    const results = () => [
      [{ id: "sf", salesChannelId: "sc" }],
      [{ id: "store", defaultRegionId: null }],
      [{ id: "sc" }],
      [],
    ];
    mocks.getDb.mockResolvedValue(database(results()));
    expect(
      await storeContextDal.resolveCatalog({ authorizedStorefrontId: "sf" }),
    ).toMatchObject({
      storefrontId: "sf",
      salesChannelId: "sc",
      regionId: null,
      currencyCode: null,
    });
    mocks.getDb.mockResolvedValue(database(results()));
    expect(
      await storeContextDal.resolve({ authorizedStorefrontId: "sf" }),
    ).toBeNull();
  });
  it("rejects a valid publishable key without assigned channels", async () => {
    const db = database([[{ id: "key", salt: "salt", token: "hash" }], []]);
    mocks.getDb.mockResolvedValue(db);
    expect(
      await storeContextDal.resolve({ publishableKey: "public" }),
    ).toBeNull();
    expect(db.select).toHaveBeenCalledTimes(2);
  });
  it("rejects mismatched theme ownership before any storefront data read", async () => {
    const db = database([[]]);
    mocks.getDb.mockResolvedValue(db);
    expect(
      await storeContextDal.resolveForTheme("foreign", "theme"),
    ).toBeNull();
    expect(db.select).toHaveBeenCalledTimes(1);
  });
  it("rejects deleted storefront and disabled channel", async () => {
    mocks.getDb.mockResolvedValue(database([[]]));
    expect(
      await storeContextDal.resolve({ authorizedStorefrontId: "deleted" }),
    ).toBeNull();
    mocks.getDb.mockResolvedValue(
      database([
        [{ id: "sf", salesChannelId: "disabled" }],
        [{ id: "store", defaultRegionId: "region" }],
        [],
      ]),
    );
    expect(
      await storeContextDal.resolve({ authorizedStorefrontId: "sf" }),
    ).toBeNull();
  });
});
