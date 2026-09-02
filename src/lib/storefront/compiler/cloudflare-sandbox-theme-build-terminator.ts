import type { ThemeBuildTerminator } from "./theme-build-terminator.types";

/**
 * The narrow slice of the Sandbox SDK this needs.
 *
 * Declared here rather than importing the SDK's generic types: only `destroy`
 * is used, and the full signature makes the compiler resolve a container type
 * graph deep enough to fail instantiation.
 */
type SandboxSessionHandle = { destroy?: () => Promise<void> };
type GetSandboxModule = {
  getSandbox: (binding: unknown, sandboxId: string) => SandboxSessionHandle;
};

/**
 * Ends a build by destroying the Sandbox session it runs in.
 *
 * The runner addresses its session by build id, and a Sandbox is a Durable
 * Object, so requesting the same id from another Worker invocation reaches the
 * very container that is building. `destroy()` is used rather than killing
 * processes individually: it removes the whole session, which is the same path
 * the runner's own timeout takes, and avoids depending on process-tree kill
 * semantics.
 */
export class CloudflareSandboxThemeBuildTerminator
  implements ThemeBuildTerminator
{
  constructor(private readonly sandboxBinding: unknown) {}

  async terminate(buildId: string): Promise<void> {
    if (!this.sandboxBinding) return;
    const { getSandbox } = (await import(
      "@cloudflare/sandbox"
    )) as unknown as GetSandboxModule;
    const sandbox = getSandbox(this.sandboxBinding, buildId);
    // A build that never reached the Sandbox has nothing to destroy, and one
    // that just finished may have destroyed itself. Neither is a cancellation
    // failure: the row has already been claimed, which is what decides the
    // outcome.
    await sandbox?.destroy?.();
  }
}
