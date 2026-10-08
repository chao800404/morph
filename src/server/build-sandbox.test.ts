// @vitest-environment node
import { describe, expect, it, vi } from "vitest";

// The SDK needs the Workers runtime; a stand-in whose `exec` each test sets.
const execImpl = vi.hoisted(() => ({
  current: (async () => ({ exitCode: 0 })) as (
    command: string,
    options?: unknown,
  ) => Promise<unknown>,
}));
vi.mock("@cloudflare/sandbox", () => {
  class Sandbox {
    exec(command: string, options?: unknown) {
      return execImpl.current(command, options);
    }
  }
  return { Sandbox };
});

import {
  classifySandboxStartError,
  SandboxStartProbeError,
} from "@/lib/storefront/compiler/sandbox-build-start";
import { Sandbox } from "./build-sandbox";

describe("the build container class", () => {
  it("probes with a command that has no effect, and answers ok", async () => {
    const exec = vi.fn(async () => ({ exitCode: 0 }));
    execImpl.current = exec;
    const sandbox = new (Sandbox as unknown as new () => Sandbox)();

    await expect(sandbox.probeStart(1234)).resolves.toEqual({ ok: true });
    expect(exec).toHaveBeenCalledWith("true", { cwd: "/", timeout: 1234 });
  });

  it("answers a failed start as a value that keeps the SDK's fields", async () => {
    execImpl.current = async () => {
      throw Object.assign(new Error("Container failed to start"), {
        name: "SandboxError",
        code: "INTERNAL_ERROR",
        context: { phase: "startup", error: "Container failed to start" },
      });
    };
    const sandbox = new (Sandbox as unknown as new () => Sandbox)();

    const answer = structuredClone(await sandbox.probeStart(1000));
    expect(answer).toMatchObject({
      ok: false,
      code: "INTERNAL_ERROR",
      context: { phase: "startup" },
    });
    if (answer.ok) throw new Error("unreachable");
    expect(classifySandboxStartError(new SandboxStartProbeError(answer))).toBe(
      "startup",
    );
  });
});
