import { env } from "cloudflare:workers";
import { randomUUID } from "node:crypto";
import { createServerFn } from "@tanstack/react-start";
import { fail, ok } from "@/lib/db/server-result";
import { commerceAdminMiddleware } from "../middleware/auth.middleware";
import { isProductionEnvironment } from "@/lib/storefront/service/storefront-domain-provider";
import {
  runByteRoundTrip,
  sandboxByteRoundTripRefusal,
  type RoundTripSandbox,
} from "@/lib/storefront/compiler/sandbox-byte-roundtrip";

/**
 * Runs the Sandbox byte round trip (`sandbox-byte-roundtrip.ts`) in a
 * container of its own, and destroys it whatever happens.
 *
 * Admin only, never in production, and only with the local flag set. The
 * answer carries checks, hashes and timings, never file contents.
 */
export const runSandboxByteRoundTrip = createServerFn({ method: "POST" })
  .middleware([commerceAdminMiddleware])
  .handler(async () => {
    const vars = env as unknown as Record<string, unknown>;
    const refusal = sandboxByteRoundTripRefusal(
      vars,
      isProductionEnvironment(vars),
    );
    if (refusal) return fail(refusal, { error: "SANDBOX_ROUNDTRIP_DISABLED" });

    const { getSandbox } = await import("@cloudflare/sandbox");
    // Its own container: never a preview's, a build's or a deployment's.
    const sandboxId = `byte-roundtrip-${randomUUID()}`;
    const sandbox = getSandbox(vars.Sandbox as never, sandboxId);
    const startedAt = Date.now();
    try {
      const result = await runByteRoundTrip(
        sandbox as unknown as RoundTripSandbox,
      );
      return ok("Sandbox byte round trip finished", {
        kind: "sandbox-write-read" as const,
        sandboxId,
        ok: result.ok,
        checks: result.checks,
        totalMs: Date.now() - startedAt,
      });
    } catch (error) {
      return fail(
        error instanceof Error
          ? error.message
          : "Sandbox byte round trip failed",
        { error: "SANDBOX_ROUNDTRIP_FAILED" },
      );
    } finally {
      await sandbox.destroy().catch(() => undefined);
    }
  });
