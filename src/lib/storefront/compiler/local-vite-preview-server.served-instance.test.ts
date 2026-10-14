// @vitest-environment node
import fs from "node:fs/promises";
import path from "node:path";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { LocalVitePreviewServer } from "./local-vite-preview-server";
import { DEFAULT_APPROVED_DEPENDENCIES } from "./sandbox-vite-theme-build-runner.types";
import {
  PREVIEW_SERVED_INSTANCE_TIMING,
  formatPreviewServedInstance,
  parsePreviewServedInstance,
  type PreviewServedInstance,
} from "../editor/preview-protocol";

/**
 * Which start served a response, against a real Vite dev server.
 *
 * The editor reloads a frame whose dev server was replaced on the same
 * address, and it can only tell from what the page's responses say. So the
 * name has to be on what a page loads — the document and its modules — and
 * has to change with every start that replaces the server, and only then.
 * It is added in this process, not to the workspace: the content snapshot,
 * and the content instance the Start preview stamps into it, stay as they
 * were.
 */

const PAGE = `export default function Page() {
  return <h1>Hello from the local preview</h1>;
}
`;

const WORKSPACES_ROOT = path.join(
  process.cwd(),
  ".morph-previews-test-served-instance",
);
const servers: LocalVitePreviewServer[] = [];

async function removeTree(target: string): Promise<void> {
  const deadline = Date.now() + 5_000;
  for (;;) {
    try {
      await fs.rm(target, { recursive: true, force: true });
      return;
    } catch {
      if (Date.now() > deadline) return;
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
  }
}

beforeAll(async () => {
  await fs.mkdir(WORKSPACES_ROOT, { recursive: true });
});

afterEach(async () => {
  for (const server of servers.splice(0)) {
    for (const previewId of server.servingPreviewIds()) {
      await server.stop(previewId).catch(() => undefined);
    }
  }
});

afterAll(async () => {
  await removeTree(WORKSPACES_ROOT);
});

function newServer() {
  const server = new LocalVitePreviewServer({
    workspacesRoot: WORKSPACES_ROOT,
    toolchainRoot: process.cwd(),
    approvedDependencies: DEFAULT_APPROVED_DEPENDENCIES,
    readyTimeoutMs: 60_000,
  });
  servers.push(server);
  return server;
}

async function start(server: LocalVitePreviewServer, page = PAGE) {
  const started = await server.start({
    previewId: "theme-a-user-1",
    files: [{ path: "src/pages/index.tsx", content: page }],
    entry: "src/pages/index.tsx",
    previewHostname: "127.0.0.1",
    platformHostEnv: {},
  });
  if (!started.ok) {
    expect.fail(`the preview failed to start: ${started.errorMessage}`);
  }
  return started;
}

const under = (url: string, suffix: string) =>
  new URL(suffix, url.endsWith("/") ? url : `${url}/`).toString();

/** The instance a response names, from its `Server-Timing` header. */
function namedBy(response: Response): PreviewServedInstance | null {
  const header = response.headers.get("server-timing") ?? "";
  const match = new RegExp(
    `${PREVIEW_SERVED_INSTANCE_TIMING};desc="([^"]+)"`,
  ).exec(header);
  return match ? parsePreviewServedInstance(match[1]) : null;
}

describe("the instance a local preview names on its responses", () => {
  it("names one instance on the document and the modules it serves", async () => {
    const server = newServer();
    const started = await start(server);
    const instance = server.servedInstanceFor("theme-a-user-1");
    expect(instance).not.toBeNull();
    expect(instance!.serial).toBe(1);

    const document = await fetch(started.url);
    expect(document.status).toBe(200);
    await document.text();
    const entry = await fetch(under(started.url, "__entry.tsx"));
    await entry.text();
    const module = await fetch(under(started.url, "src/pages/index.tsx"));
    await module.text();

    for (const response of [document, entry, module]) {
      expect(namedBy(response)).toEqual(instance);
    }
    // In the header form the page reads through the Performance API.
    expect(document.headers.get("server-timing")).toContain(
      `desc="${formatPreviewServedInstance(instance!)}"`,
    );
  }, 120_000);

  it("keeps the name for a reused server and changes it for a replaced one", async () => {
    const server = newServer();
    await start(server);
    const firstInstance = server.servedInstanceFor("theme-a-user-1");

    const again = await start(server);
    expect(again.timings.reusedProcess).toBe(true);
    expect(server.servedInstanceFor("theme-a-user-1")).toEqual(firstInstance);
    expect(namedBy(await fetch(again.url))).toEqual(firstInstance);

    const replaced = await start(server, PAGE.replace("Hello", "Goodbye"));
    expect(replaced.timings.reusedProcess).toBe(false);
    const replacedInstance = server.servedInstanceFor("theme-a-user-1");
    expect(replacedInstance).toEqual({
      session: firstInstance!.session,
      serial: firstInstance!.serial + 1,
    });
    expect(namedBy(await fetch(replaced.url))).toEqual(replacedInstance);
  }, 180_000);

  it("names a different session for another process's server", async () => {
    const one = newServer();
    await start(one);
    const oneInstance = one.servedInstanceFor("theme-a-user-1");
    await one.stop("theme-a-user-1");
    expect(one.servedInstanceFor("theme-a-user-1")).toBeNull();

    const other = newServer();
    const started = await start(other);
    const otherInstance = other.servedInstanceFor("theme-a-user-1");
    expect(otherInstance!.session).not.toBe(oneInstance!.session);
    expect(otherInstance!.serial).toBe(1);
    expect(namedBy(await fetch(started.url))).toEqual(otherInstance);
  }, 180_000);

  it("leaves the client-only content snapshot and its instance as they were", async () => {
    const server = newServer();
    const started = await start(server);

    const content = await fetch(
      new URL("/_morph/content?path=/", started.url),
    );
    expect(content.status).toBe(200);
    const body = (await content.json()) as Record<string, unknown>;
    expect(body).not.toHaveProperty("previewInstance");
    // No content instance: nothing confirms a client-only preview's content,
    // whatever its responses are named.
    expect(
      await server.confirmContent("theme-a-user-1", 1, {
        confirmTimeoutMs: 100,
      }),
    ).toEqual({
      applied: false,
      reason: "PREVIEW_CONTENT_UNCONFIRMABLE",
      ticket: 1,
    });
  }, 120_000);
});
