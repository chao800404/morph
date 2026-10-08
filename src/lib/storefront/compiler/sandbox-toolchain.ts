import {
  shortToolchainId,
  type ThemeToolchain,
} from "../theme-framework/theme-toolchains";

/** The one session capability this needs, as both build and preview sessions have it. */
export type SandboxToolchainSession = {
  exec(
    command: string,
    options?: { cwd?: string; timeout?: number; timeoutMs?: number },
  ): Promise<{
    success?: boolean;
    exitCode?: number;
    stdout?: string;
    stderr?: string;
  }>;
};

/**
 * Before anything of the Theme is written or run: the container's manifest for
 * the recorded toolchain must be the one the build records, and this build's
 * workspace is linked to that toolchain (and to no other).
 *
 * A compatibility and provenance check, not tamper evidence: processes in the
 * container run as root, so code that runs after this can still change the
 * installed files. It shows the container declared the expected toolchain
 * when the build began.
 */
export async function prepareSandboxToolchain(
  session: SandboxToolchainSession,
  toolchain: ThemeToolchain,
  addLog: (level: "info" | "warn" | "error", message: string) => void,
): Promise<
  | Readonly<{ ok: true }>
  | Readonly<{ ok: false; code: string; message: string }>
> {
  const hashed = await session.exec(`sha256sum ${toolchain.manifestPath}`, {
    cwd: "/",
    timeout: 30_000,
    timeoutMs: 30_000,
  });
  const found = (hashed.stdout ?? "").trim().split(/\s+/)[0] ?? "";
  if (
    !(hashed.success ?? hashed.exitCode === 0) ||
    !/^[0-9a-f]{64}$/.test(found)
  ) {
    return {
      ok: false,
      code: "THEME_TOOLCHAIN_MISMATCH",
      message: `The container has no readable manifest for toolchain ${shortToolchainId(toolchain.id)} at ${toolchain.manifestPath}.`,
    };
  }
  if (found !== toolchain.id) {
    return {
      ok: false,
      code: "THEME_TOOLCHAIN_MISMATCH",
      message: `The container's toolchain manifest hashes to ${found}, but the build records ${toolchain.id}. It is not built with a different toolchain.`,
    };
  }
  const linked = await session.exec(
    `mkdir -p /workspace && rm -f /workspace/node_modules && ln -s ${toolchain.root}/node_modules /workspace/node_modules`,
    { cwd: "/", timeout: 30_000, timeoutMs: 30_000 },
  );
  if (!(linked.success ?? linked.exitCode === 0)) {
    return {
      ok: false,
      code: "THEME_TOOLCHAIN_LINK_FAILED",
      message: `Could not link the workspace to toolchain ${shortToolchainId(toolchain.id)}: ${linked.stderr || linked.stdout || "unknown error"}`,
    };
  }
  addLog(
    "info",
    `Toolchain ${toolchain.framework} ${shortToolchainId(toolchain.id)} checked against its manifest and linked.`,
  );
  return { ok: true };
}
