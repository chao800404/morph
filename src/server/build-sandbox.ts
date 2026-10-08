import { Sandbox as SdkSandbox } from "@cloudflare/sandbox";
import {
  describeSandboxStartError,
  type SandboxStartProbeResult,
} from "@/lib/storefront/compiler/sandbox-build-start";

/**
 * The Durable Object class Theme build containers run under (binding
 * `Sandbox`, class name `Sandbox`, as before: the name is what Wrangler's
 * migrations know, so it is kept).
 *
 * The SDK's class with one method more. The build's start probe runs here,
 * inside the Durable Object, because a start failure thrown across RPC
 * arrives as a plain `Error` with only its message, and the build could not
 * tell a failed start from any other failure (sandbox-build-start.ts).
 */
export class Sandbox extends SdkSandbox {
  /**
   * Runs `true` in the container, starting it if it is not running, and
   * answers with the outcome as a value. Has no effect of its own.
   */
  async probeStart(timeoutMs: number): Promise<SandboxStartProbeResult> {
    try {
      await this.exec("true", {
        cwd: "/",
        timeout: timeoutMs,
      });
      return { ok: true };
    } catch (error) {
      return describeSandboxStartError(error);
    }
  }
}
