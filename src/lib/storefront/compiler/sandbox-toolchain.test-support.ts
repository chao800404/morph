import {
  registeredThemeToolchains,
  themeToolchainForFramework,
} from "../theme-framework/theme-toolchains";

/** The registry's TanStack Start toolchain: what every Start test build records. */
export const START_TOOLCHAIN = themeToolchainForFramework("tanstack-start");

/**
 * A container's answer to `prepareSandboxToolchain`'s two commands: the
 * manifest hash (the identity the registry gives the toolchain at that
 * root, or `manifestHash` to simulate a mismatch) and the workspace link.
 * Any other command is not answered here (returns null), so a test's own
 * exec handles it.
 */
export function answerToolchainCommand(
  command: string,
  manifestHash?: string,
): {
  success: boolean;
  exitCode: number;
  stdout: string;
  stderr: string;
} | null {
  if (
    command.startsWith("sha256sum ") &&
    command.endsWith("/toolchain.manifest.json")
  ) {
    const path = command.slice("sha256sum ".length);
    const hash =
      manifestHash ??
      registeredThemeToolchains().find((toolchain) =>
        path.startsWith(`${toolchain.root}/`),
      )?.id ??
      START_TOOLCHAIN.id;
    return {
      success: true,
      exitCode: 0,
      stdout: `${hash}  ${path}\n`,
      stderr: "",
    };
  }
  if (
    command.includes("ln -s ") &&
    command.includes("/workspace/node_modules")
  ) {
    return { success: true, exitCode: 0, stdout: "", stderr: "" };
  }
  return null;
}

export function isToolchainCommand(command: string): boolean {
  return answerToolchainCommand(command) !== null;
}
