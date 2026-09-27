// @vitest-environment node
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { THEME_PUBLIC_RESERVED_URL_PREFIXES } from "../theme-public-files";
import {
  rootPublicRequestTarget,
  themePreviewRootPublicPluginSource,
} from "./theme-preview-root-public";
import { THEME_PREVIEW_SERVER_BASE_PATH } from "./theme-preview-dev-server";

const BASE = THEME_PREVIEW_SERVER_BASE_PATH;
let root = "";
let publicDir = "";

/** A workspace holding files where each rule has something to refuse. */
beforeAll(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), "preview-root-public-"));
  publicDir = path.join(root, "public");
  const file = (relative: string) => {
    const at = path.join(root, relative);
    fs.mkdirSync(path.dirname(at), { recursive: true });
    fs.writeFileSync(at, "x");
  };
  file("public/icons/nested/hero.png");
  file("public/icons/logo.svg");
  file("public/favicon.ico");
  file("public/.env");
  file("public/api/store/products/x.png");
  file("public/assets/y.png");
  file("public/_morph/z.png");
  file("public/@vite/client");
  file("secret.txt");
});

afterAll(() => {
  fs.rmSync(root, { recursive: true, force: true });
});

const options = () => ({
  base: BASE,
  publicDir,
  reservedPrefixes: THEME_PUBLIC_RESERVED_URL_PREFIXES,
  path,
  isFile: (file: string) => {
    try {
      return fs.statSync(file).isFile();
    } catch {
      return false;
    }
  },
});
const target = (url: string, method = "GET") =>
  rootPublicRequestTarget(options(), method, url);

describe("rootPublicRequestTarget", () => {
  it("serves a nested public/ file at the root URL a Theme writes", () => {
    expect(target("/icons/nested/hero.png")).toBe(
      `${BASE}icons/nested/hero.png`,
    );
    expect(target("/icons/logo.svg?v=2#x")).toBe(`${BASE}icons/logo.svg?v=2#x`);
    expect(target("/favicon.ico", "HEAD")).toBe(`${BASE}favicon.ico`);
  });

  it("leaves a request that is not a read of an existing file", () => {
    expect(target("/icons/nested/hero.png", "POST")).toBeNull();
    // Missing: left for the same 404 as before.
    expect(target("/icons/nested/missing.png")).toBeNull();
    // A directory is not a file.
    expect(target("/icons")).toBeNull();
    expect(target("/")).toBeNull();
    expect(target("icons/logo.svg")).toBeNull();
  });

  it("never touches the preview's own paths or Vite's", () => {
    expect(target(`${BASE}icons/logo.svg`)).toBeNull();
    expect(target(BASE.replace(/\/$/, ""))).toBeNull();
    // Even with a file of that name in public/.
    expect(target("/@vite/client")).toBeNull();
    expect(target("/__vite_ping")).toBeNull();
  });

  it("never serves a public/ file under a prefix the platform answers", () => {
    expect(target("/api/store/products/x.png")).toBeNull();
    expect(target("/API/Store/products/x.png")).toBeNull();
    expect(target("/assets/y.png")).toBeNull();
    expect(target("/_morph/z.png")).toBeNull();
  });

  it("refuses anything that is not a plain path inside public/", () => {
    expect(target("/.env")).toBeNull();
    expect(target("/../secret.txt")).toBeNull();
    expect(target("/%2e%2e/secret.txt")).toBeNull();
    expect(target("/icons/%2e%2e/%2e%2e/secret.txt")).toBeNull();
    expect(target("/icons//logo.svg")).toBeNull();
    expect(target("/icons%5c..%5c..%5csecret.txt")).toBeNull();
    expect(target("/%E0%A4%A")).toBeNull();
  });
});

describe("the plugin as the generated preview config carries it", () => {
  type Middleware = (
    request: { method: string; url: string },
    response: unknown,
    next: () => void,
  ) => void;

  function embedded(): Middleware {
    const plugin = new Function(
      "path",
      "fs",
      `return (${themePreviewRootPublicPluginSource(JSON.stringify(root))});`,
    )(path, fs);
    let middleware: Middleware | null = null;
    plugin.configureServer({
      middlewares: { use: (fn: Middleware) => (middleware = fn) },
    });
    return middleware!;
  }

  it("rewrites the request it maps and passes every request on", () => {
    const middleware = embedded();
    const run = (method: string, url: string) => {
      const request = { method, url };
      let passed = false;
      middleware(request, {}, () => {
        passed = true;
      });
      return { url: request.url, passed };
    };
    expect(run("GET", "/icons/nested/hero.png")).toEqual({
      url: `${BASE}icons/nested/hero.png`,
      passed: true,
    });
    expect(run("GET", "/icons/nested/missing.png")).toEqual({
      url: "/icons/nested/missing.png",
      passed: true,
    });
    expect(run("GET", "/api/store/products/x.png")).toEqual({
      url: "/api/store/products/x.png",
      passed: true,
    });
  });
});
