/**
 * A `CloudflareSandboxProvider` backed by a local Docker container of the
 * Sandbox image (`Dockerfile.sandbox`), for tests that need the real image
 * without the Worker, Durable Object and container plugin in front of it.
 *
 * Each `getSandbox` starts one container of the given image and answers the
 * runner's session calls with `docker exec` in it: the same commands, working
 * directory and environment the runner hands the Sandbox SDK, run by the
 * image's own shell, node and toolchains. `destroy` removes that container,
 * and only that one. What this does not cover is the SDK's transport and the
 * container's start through the Worker; the container acceptance job does.
 */
import { spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import type {
  CloudflareSandboxExecResult,
  CloudflareSandboxProvider,
  CloudflareSandboxSession,
} from "./cloudflare-sandbox-vite-theme-build-runner";

type DockerResult = { exitCode: number; stdout: Buffer; stderr: string };

function docker(
  args: string[],
  options: { input?: Buffer; timeoutMs: number },
): Promise<DockerResult> {
  return new Promise((resolve, reject) => {
    const child = spawn("docker", args, {
      stdio: ["pipe", "pipe", "pipe"],
    });
    const stdout: Buffer[] = [];
    const stderr: Buffer[] = [];
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      child.kill("SIGKILL");
    }, options.timeoutMs);
    child.stdout.on("data", (chunk: Buffer) => stdout.push(chunk));
    child.stderr.on("data", (chunk: Buffer) => stderr.push(chunk));
    child.on("error", (error) => {
      clearTimeout(timer);
      reject(error);
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      const err = Buffer.concat(stderr).toString("utf8");
      resolve({
        exitCode: timedOut ? 124 : (code ?? 1),
        stdout: Buffer.concat(stdout),
        stderr: timedOut
          ? `${err}\nDOCKER_SESSION_TIMEOUT: docker ${args[0]} exceeded ${options.timeoutMs} ms`
          : err,
      });
    });
    child.stdin.end(options.input);
  });
}

/** Whether a Docker daemon answers, for `describe.skipIf`. */
export async function dockerAvailable(): Promise<boolean> {
  try {
    const info = await docker(["info", "--format", "{{.ServerVersion}}"], {
      timeoutMs: 15_000,
    });
    return info.exitCode === 0;
  } catch {
    return false;
  }
}

export type DockerSandboxProviderOptions = Readonly<{
  /** A local tag of the Sandbox image, built from `Dockerfile.sandbox`. */
  image: string;
  /** Prefix of the containers it starts; each name adds a random suffix. */
  namePrefix: string;
  /**
   * Called with each container's name as it starts, so a caller can remove
   * what a crashed run left behind. Only names this provider made.
   */
  onStart?: (name: string) => void;
}>;

export function dockerSandboxProvider(
  options: DockerSandboxProviderOptions,
): CloudflareSandboxProvider {
  return {
    async getSandbox(_binding, sandboxId) {
      const name = `${options.namePrefix}-${randomBytes(4).toString("hex")}`;
      options.onStart?.(name);
      // The image's own entrypoint is the SDK's control server; the runner's
      // calls arrive here through `docker exec` instead, so the container
      // only has to stay up.
      const started = await docker(
        [
          "run",
          "--detach",
          "--rm",
          "--name",
          name,
          "--label",
          `dev.morph.sandbox-smoke=${sandboxId.replace(/[^A-Za-z0-9_.-]/g, "_")}`,
          "--entrypoint",
          "sleep",
          options.image,
          "infinity",
        ],
        { timeoutMs: 60_000 },
      );
      if (started.exitCode !== 0) {
        throw new Error(
          `DOCKER_SANDBOX_START_FAILED: docker run ${options.image}: ${started.stderr.trim()}`,
        );
      }
      return dockerSandboxSession(name);
    },
  };
}

function dockerSandboxSession(name: string): CloudflareSandboxSession {
  const shell = (
    command: string,
    options: {
      cwd?: string;
      env?: Record<string, string>;
      input?: Buffer;
      timeoutMs: number;
    },
  ) =>
    docker(
      [
        "exec",
        ...(options.input ? ["--interactive"] : []),
        "--workdir",
        options.cwd ?? "/workspace",
        ...Object.entries(options.env ?? {}).flatMap(([key, value]) => [
          "--env",
          `${key}=${value}`,
        ]),
        name,
        "bash",
        "-c",
        command,
      ],
      { input: options.input, timeoutMs: options.timeoutMs },
    );
  const ok = (result: DockerResult, what: string) => {
    if (result.exitCode !== 0)
      throw new Error(`${what} failed in ${name}: ${result.stderr.trim()}`);
  };
  return {
    async writeFile(filePath, content, writeOptions) {
      const bytes =
        writeOptions?.encoding === "base64"
          ? Buffer.from(content, "base64")
          : Buffer.from(content, "utf8");
      ok(
        await shell(`cat > ${JSON.stringify(filePath)}`, {
          cwd: "/",
          input: bytes,
          timeoutMs: 30_000,
        }),
        `writeFile ${filePath}`,
      );
    },
    async mkdir(dirPath, mkdirOptions) {
      ok(
        await shell(
          `mkdir ${mkdirOptions?.recursive ? "-p " : ""}${JSON.stringify(dirPath)}`,
          { cwd: "/", timeoutMs: 30_000 },
        ),
        `mkdir ${dirPath}`,
      );
    },
    async readFile(filePath, readOptions) {
      const read = await shell(`cat ${JSON.stringify(filePath)}`, {
        cwd: "/",
        timeoutMs: 30_000,
      });
      ok(read, `readFile ${filePath}`);
      const encoding =
        typeof readOptions === "string" ? readOptions : readOptions?.encoding;
      if (encoding === "utf-8" || encoding === "utf8") {
        return { content: read.stdout.toString("utf8") };
      }
      return new Uint8Array(read.stdout);
    },
    async exec(command, execOptions) {
      const timeoutMs =
        execOptions?.timeoutMs ?? execOptions?.timeout ?? 120_000;
      const result = await shell(command, {
        cwd: execOptions?.cwd,
        env: execOptions?.env,
        timeoutMs,
      });
      return {
        success: result.exitCode === 0,
        exitCode: result.exitCode,
        stdout: result.stdout.toString("utf8"),
        stderr: result.stderr,
      } satisfies CloudflareSandboxExecResult;
    },
    async destroy() {
      await docker(["rm", "--force", name], { timeoutMs: 30_000 });
    },
  };
}
