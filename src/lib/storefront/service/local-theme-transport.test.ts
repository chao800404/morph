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
const { createThemeRuntime } = await import("./storefront-request-routing");
const { localThemeTransportAllowed } = await import("./local-theme-transport");

function setEnv(next: Record<string, unknown>) {
  for (const key of Object.keys(bindings)) delete bindings[key];
  Object.assign(bindings, next);
}

const originalNodeEnv = process.env.NODE_ENV;
afterEach(() => {
  process.env.NODE_ENV = originalNodeEnv;
  setEnv({});
});

const ORIGIN = { MORPH_LOCAL_THEME_ORIGIN: "http://127.0.0.1:8799" };

type Case = {
  name: string;
  nodeEnv: string;
  env: Record<string, unknown>;
  allowed: boolean;
};

const MATRIX: Case[] = [
  { name: "dev, origin only", nodeEnv: "development", env: ORIGIN, allowed: true },
  {
    name: "dev, origin with deploy prerequisites",
    nodeEnv: "development",
    env: { ...ORIGIN, Sandbox: {}, R2_BUCKET: {} },
    allowed: true,
  },
  { name: "dev, no origin", nodeEnv: "development", env: {}, allowed: false },
  {
    name: "dev, blank origin",
    nodeEnv: "development",
    env: { MORPH_LOCAL_THEME_ORIGIN: "   " },
    allowed: false,
  },
  {
    name: "dev, origin + api token",
    nodeEnv: "development",
    env: { ...ORIGIN, CLOUDFLARE_API_TOKEN: "token" },
    allowed: false,
  },
  {
    name: "dev, origin + account id",
    nodeEnv: "development",
    env: { ...ORIGIN, CLOUDFLARE_ACCOUNT_ID: "account" },
    allowed: false,
  },
  {
    name: "ENVIRONMENT=production",
    nodeEnv: "development",
    env: { ...ORIGIN, ENVIRONMENT: "production" },
    allowed: false,
  },
  {
    name: "CF_PAGES=1",
    nodeEnv: "development",
    env: { ...ORIGIN, CF_PAGES: "1" },
    allowed: false,
  },
  {
    name: "NODE_ENV=production",
    nodeEnv: "production",
    env: ORIGIN,
    allowed: false,
  },
];

describe("localThemeTransportAllowed", () => {
  it.each(MATRIX)("$name -> allowed=$allowed", ({ nodeEnv, env, allowed }) => {
    process.env.NODE_ENV = nodeEnv;
    expect(localThemeTransportAllowed(env)).toBe(allowed);
  });

  it("is false for a missing environment", () => {
    process.env.NODE_ENV = "development";
    expect(localThemeTransportAllowed(undefined)).toBe(false);
  });
});

describe("deployer factory and storefront runtime agree", () => {
  it.each(MATRIX)("$name", ({ nodeEnv, env, allowed }) => {
    process.env.NODE_ENV = nodeEnv;
    setEnv(env);

    const deployerIsLocal =
      createServerThemeWorkerDeployer().kind === "operator-managed";
    const runtimeIsLocal = createThemeRuntime(env).kind === "local-direct";

    expect(deployerIsLocal, "deployer").toBe(allowed);
    expect(runtimeIsLocal, "runtime").toBe(allowed);
  });
});
