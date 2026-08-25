import { afterEach, describe, expect, it, vi } from "vitest";

const bindings: Record<string, unknown> = {};
vi.mock("cloudflare:workers", () => ({
  get env() {
    return bindings;
  },
}));

const { createServerThemeWorkerDeployer } = await import(
  "./theme-worker-deployer.factory"
);

function setEnv(next: Record<string, unknown>) {
  for (const key of Object.keys(bindings)) delete bindings[key];
  Object.assign(bindings, next);
}

const originalNodeEnv = process.env.NODE_ENV;
afterEach(() => {
  process.env.NODE_ENV = originalNodeEnv;
  setEnv({});
});

const FULL = {
  Sandbox: {},
  R2_BUCKET: {},
  CLOUDFLARE_API_TOKEN: "token",
  CLOUDFLARE_ACCOUNT_ID: "account",
};

describe("createServerThemeWorkerDeployer", () => {
  it("uses the sandbox wrangler deployer when everything is configured", () => {
    setEnv(FULL);
    expect(createServerThemeWorkerDeployer().kind).toBe("sandbox-wrangler");
  });

  it("reports exactly what is missing instead of partially wiring", () => {
    for (const missing of Object.keys(FULL)) {
      const partial: Record<string, unknown> = { ...FULL };
      delete partial[missing];
      setEnv(partial);
      const deployer = createServerThemeWorkerDeployer();
      expect(deployer.kind, `missing ${missing}`).toBe("unavailable");
    }
  });

  it("treats an operator-started local Theme Worker as nothing to deploy", () => {
    process.env.NODE_ENV = "development";
    setEnv({
      Sandbox: {},
      R2_BUCKET: {},
      MORPH_LOCAL_THEME_ORIGIN: "http://127.0.0.1:8799",
    });
    expect(createServerThemeWorkerDeployer().kind).toBe("operator-managed");
  });

  it("never skips deployment when real credentials are present", () => {
    process.env.NODE_ENV = "development";
    setEnv({ ...FULL, MORPH_LOCAL_THEME_ORIGIN: "http://127.0.0.1:8799" });
    expect(createServerThemeWorkerDeployer().kind).toBe("sandbox-wrangler");
  });

  it("never skips deployment in production", () => {
    process.env.NODE_ENV = "development";
    for (const productionEnv of [
      { CF_PAGES: "1" },
      { ENVIRONMENT: "production" },
    ]) {
      setEnv({
        Sandbox: {},
        R2_BUCKET: {},
        MORPH_LOCAL_THEME_ORIGIN: "http://127.0.0.1:8799",
        ...productionEnv,
      });
      expect(createServerThemeWorkerDeployer().kind).toBe("unavailable");
    }

    process.env.NODE_ENV = "production";
    setEnv({
      Sandbox: {},
      R2_BUCKET: {},
      MORPH_LOCAL_THEME_ORIGIN: "http://127.0.0.1:8799",
    });
    expect(createServerThemeWorkerDeployer().kind).toBe("unavailable");
  });

  it("an unavailable deployer fails closed rather than reporting success", async () => {
    setEnv({});
    const result = await createServerThemeWorkerDeployer().deploy({} as never);
    expect(result.success).toBe(false);
    if (result.success) return;
    expect(result.reason).toBe("DEPLOYER_NOT_CONFIGURED");
    expect(result.message).toContain("CLOUDFLARE_API_TOKEN");
  });
});
