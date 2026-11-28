import { spawn, type ChildProcess } from "node:child_process";
import { createRequire } from "node:module";
import readline from "node:readline";
import type { Readable } from "node:stream";

/**
 * Runs the pinned `workerd` binary on a capnp config for a test, listening
 * on a port the operating system assigns.
 *
 * A test must not choose its own port: one picked at random (or probed free
 * and then released) can be taken by another test file running in parallel,
 * or by any process's outbound connection in the ephemeral range, before
 * workerd binds it; workerd then exits with `bind(): Address already in use`
 * (CI run 46100822900, job 140842617473). Here the named socket is always
 * bound to `127.0.0.1:0` (`--socket-addr` overrides whatever the config says)
 * and the port is read from workerd's own control message (`--control-fd`),
 * sent once the socket is listening — the way Miniflare starts workerd.
 *
 * The native binary is spawned directly, not the `workerd/bin/workerd` Node
 * shim: the shim does not pass the control descriptor on, and killing the
 * shim leaves the real workerd running.
 */

export interface ServedWorkerd {
  /** `http://127.0.0.1:<port>`, the socket workerd is listening on. */
  readonly origin: string;
  readonly port: number;
  readonly child: ChildProcess;
  /** What workerd wrote to stdout and stderr so far. */
  output(): string;
  /** Kills workerd and waits for it to exit. */
  stop(): Promise<void>;
}

const CONTROL_FD = 3;

function workerdBinary(): string {
  const workerd = createRequire(import.meta.url)("workerd") as {
    default: string;
  };
  return workerd.default;
}

function exited(child: ChildProcess): boolean {
  return child.exitCode !== null || child.signalCode !== null;
}

async function stop(child: ChildProcess): Promise<void> {
  if (exited(child)) return;
  const done = new Promise<void>((resolve) =>
    child.once("exit", () => resolve()),
  );
  child.kill("SIGKILL");
  await done;
}

/**
 * Starts `workerd serve <configPath>` with the config's socket `socket` on an
 * OS-assigned loopback port. Resolves once that socket is listening; rejects,
 * with workerd's output, if workerd exits first or does not listen within
 * `timeoutMs`. Nothing is retried: a workerd that cannot start fails the test.
 */
export async function serveWorkerd(
  configPath: string,
  options: { socket: string; timeoutMs?: number },
): Promise<ServedWorkerd> {
  const { socket, timeoutMs = 30_000 } = options;
  const child = spawn(
    workerdBinary(),
    [
      "serve",
      `--socket-addr=${socket}=127.0.0.1:0`,
      `--control-fd=${CONTROL_FD}`,
      configPath,
    ],
    { stdio: ["ignore", "pipe", "pipe", "pipe"] },
  );
  const chunks: string[] = [];
  child.stdout?.on("data", (chunk) => chunks.push(String(chunk)));
  child.stderr?.on("data", (chunk) => chunks.push(String(chunk)));
  const output = () => chunks.join("");

  const control = child.stdio[CONTROL_FD] as Readable;
  const lines = readline.createInterface({ input: control });
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const port = await new Promise<number>((resolve, reject) => {
      lines.on("line", (line) => {
        let message: unknown;
        try {
          message = JSON.parse(line);
        } catch {
          return;
        }
        const {
          event,
          socket: name,
          port,
        } = (message ?? {}) as Record<string, unknown>;
        if (event === "listen" && name === socket && typeof port === "number") {
          resolve(port);
        }
      });
      child.once("error", reject);
      child.once("exit", (code, signal) =>
        reject(
          new Error(
            `workerd exited (${signal ?? code}) before socket "${socket}" listened: ${output()}`,
          ),
        ),
      );
      timer = setTimeout(
        () =>
          reject(
            new Error(
              `workerd's socket "${socket}" did not listen within ${timeoutMs} ms: ${output()}`,
            ),
          ),
        timeoutMs,
      );
    });
    return {
      origin: `http://127.0.0.1:${port}`,
      port,
      child,
      output,
      stop: () => stop(child),
    };
  } catch (error) {
    await stop(child);
    throw error;
  } finally {
    clearTimeout(timer);
    lines.close();
  }
}
