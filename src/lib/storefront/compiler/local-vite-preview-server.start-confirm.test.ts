// @vitest-environment node
import { EventEmitter } from "node:events";
import fs from "node:fs/promises";
import path from "node:path";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { STARTER_THEME_FILES } from "@/lib/storefront/starter-theme-files";

/**
 * Whether the parent registers the instance a Start child was handed, with
 * the child replaced by a stand-in that answers as told. Only a child that
 * confirms exactly the value it was handed is registered; any other answer
 * leaves the instance unknown, and the preview still serves.
 */

const childReply = vi.hoisted(() => ({
  servedTiming: (handed: string | undefined): unknown => handed,
  argv: [] as string[][],
}));

vi.mock("node:child_process", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:child_process")>();
  return {
    ...actual,
    fork: (modulePath: string, args: string[]) => {
      // Only the Start child is stood in for; anything else is real.
      if (!modulePath.endsWith("local-vite-preview-child.mjs")) {
        return (actual.fork as (...a: unknown[]) => unknown)(modulePath, args);
      }
      childReply.argv.push([...args]);
      const child = new EventEmitter() as EventEmitter & {
        stdout: EventEmitter;
        stderr: EventEmitter;
        kill: (signal?: string) => boolean;
      };
      child.stdout = new EventEmitter();
      child.stderr = new EventEmitter();
      child.kill = () => {
        setImmediate(() => child.emit("exit", 0, null));
        return true;
      };
      setImmediate(() =>
        child.emit("message", {
          type: "ready",
          port: 49_321,
          servedTiming: childReply.servedTiming(args[3]),
        }),
      );
      return child;
    },
  };
});

const { LocalVitePreviewServer } = await import("./local-vite-preview-server");
const { DEFAULT_APPROVED_DEPENDENCIES } = await import(
  "./sandbox-vite-theme-build-runner.types"
);

const WORKSPACES_ROOT = path.join(
  process.cwd(),
  ".morph-previews-start-confirm-test",
);
const PREVIEW_ID = "start-confirm-test";
let server: InstanceType<typeof LocalVitePreviewServer>;

beforeAll(async () => {
  await fs.mkdir(WORKSPACES_ROOT, { recursive: true });
});

afterEach(async () => {
  await server?.stop(PREVIEW_ID).catch(() => {});
  childReply.argv.length = 0;
});

afterAll(async () => {
  await fs
    .rm(WORKSPACES_ROOT, { recursive: true, force: true })
    .catch(() => {});
});

async function startWith(reply: (handed: string | undefined) => unknown) {
  childReply.servedTiming = reply;
  server = new LocalVitePreviewServer({
    workspacesRoot: WORKSPACES_ROOT,
    toolchainRoot: process.cwd(),
    approvedDependencies: DEFAULT_APPROVED_DEPENDENCIES,
  });
  const started = await server.start({
    previewId: PREVIEW_ID,
    files: [...STARTER_THEME_FILES] as never,
    entry: "src/routes/index.tsx",
    previewHostname: "127.0.0.1",
    platformHostEnv: {},
    previewRuntime: "start",
  });
  if (!started.ok) expect.fail(`${started.stage}: ${started.errorMessage}`);
  return started;
}

describe("registering a Start child's instance", { timeout: 60_000 }, () => {
  it("hands the child the instance it mints, and registers it once confirmed", async () => {
    const started = await startWith((handed) => handed);
    const handed = childReply.argv[0]?.[3];
    expect(handed).toMatch(
      /^morph-instance;desc="[A-Za-z0-9-]{8,64}\.[1-9]\d*"$/,
    );
    const instance = server.servedInstanceFor(PREVIEW_ID);
    expect(instance).not.toBeNull();
    expect(handed).toBe(
      `morph-instance;desc="${instance!.session}.${instance!.serial}"`,
    );
    expect(started.serving?.instance).toEqual(instance);
    expect(started.serving?.bridge.buildId).toMatch(/^[0-9a-f]{64}$/);
  });

  it.each([
    [
      "another instance",
      (handed: string | undefined) => handed?.replace(/\.(\d+)"$/, '.99"'),
    ],
    ["nothing (an older child)", () => undefined],
    ["null", () => null],
    ["something that is not a string", () => ({ session: "x", serial: 1 })],
  ])("leaves the instance unknown when the child confirms %s", async (_label, reply) => {
    const started = await startWith(reply);
    expect(server.servedInstanceFor(PREVIEW_ID)).toBeNull();
    // Still served, with the bridge known and the instance not.
    expect(started.serving?.instance).toBeNull();
    expect(started.serving?.bridge.buildId).toMatch(/^[0-9a-f]{64}$/);
    expect(started.logs.join("\n")).toContain(
      "Start child did not confirm its served instance",
    );
  });
});
