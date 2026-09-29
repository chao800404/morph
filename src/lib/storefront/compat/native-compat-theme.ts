/**
 * Ordinary TanStack Start code, added to the starter Theme to check that a
 * Theme behaves the way the same source would in a plain Start app on
 * Cloudflare Workers: SSR, loaders, server functions, both kinds of
 * middleware, server routes, cookies, redirects and error boundaries.
 *
 * Nothing here is written for Morph. That is the point: the compatibility
 * suites build and serve these files and compare the behaviour with Start's
 * own, so the files must stay what an engineer would write locally. Stored as
 * strings, like the starter Theme, because they are Theme source rather than
 * Morph source and are compiled only by the Theme toolchain.
 *
 * Used by `native-compat.test.ts` (the built Worker, in CI) and by the
 * end-to-end compatibility run (Live Preview and the published storefront).
 */

export type NativeCompatFile = Readonly<{ path: string; content: string }>;

const START = String.raw`import { createMiddleware, createStart } from "@tanstack/react-start";
import { setResponseHeader } from "@tanstack/react-start/server";

// Global request middleware: runs for every request the Start handler serves.
const compatRequestMiddleware = createMiddleware().server(async ({ next }) => {
  setResponseHeader("x-compat-request-mw", "1");
  return next();
});

export const startInstance = createStart(() => ({
  requestMiddleware: [compatRequestMiddleware],
}));
`;

const FNS = String.raw`import { createMiddleware, createServerFn } from "@tanstack/react-start";
import { getRequest, setResponseHeader } from "@tanstack/react-start/server";

const compatFunctionMiddleware = createMiddleware({ type: "function" }).server(
  async ({ next }) => next({ context: { fromMiddleware: "fn-mw-ok" } }),
);

export const getGreeting = createServerFn({ method: "GET" })
  .middleware([compatFunctionMiddleware])
  .inputValidator((data: { name: string }) => data)
  .handler(async ({ data, context }) => ({
    greeting: "hello " + data.name,
    middleware: context.fromMiddleware,
    ranOnServer: typeof window === "undefined",
    method: getRequest().method,
  }));

export const incrementCounter = createServerFn({ method: "POST" })
  .inputValidator((data: { by: number }) => data)
  .handler(async ({ data }) => {
    const cookie = getRequest().headers.get("cookie") ?? "";
    const previous = /(?:^|; )compat_count=(\d+)/.exec(cookie)?.[1] ?? "0";
    const count = Number(previous) + data.by;
    setResponseHeader("set-cookie", "compat_count=" + count + "; Path=/; HttpOnly");
    return { count, method: getRequest().method };
  });

export const failingFn = createServerFn({ method: "GET" }).handler(async () => {
  throw new Error("compat-fn-error");
});
`;

const COMPAT_PAGE = String.raw`import { useState } from "react";
import { Link, createFileRoute } from "@tanstack/react-router";
import { failingFn, getGreeting, incrementCounter } from "../compat/fns";

export const Route = createFileRoute("/compat")({
  loader: async () => getGreeting({ data: { name: "loader" } }),
  component: CompatPage,
});

function CompatPage() {
  const loaded = Route.useLoaderData();
  const [result, setResult] = useState("idle");
  const [items] = useState(["alpha", "beta"]);
  return (
    <main data-compat-page>
      <p data-compat="loader">{JSON.stringify(loaded)}</p>
      {items.map((item) => (
        <span key={item} data-compat-item>{item}</span>
      ))}
      {loaded.ranOnServer ? <p data-compat="conditional">server-rendered-branch</p> : null}
      <button type="button" data-compat="get" onClick={async () => setResult(JSON.stringify(await getGreeting({ data: { name: "client" } })))}>get</button>
      <button type="button" data-compat="post" onClick={async () => setResult(JSON.stringify(await incrementCounter({ data: { by: 2 } })))}>post</button>
      <button type="button" data-compat="fail" onClick={async () => { try { await failingFn(); setResult("no-error"); } catch (error) { setResult("caught:" + (error instanceof Error ? error.message : String(error))); } }}>fail</button>
      <p data-compat="result">{result}</p>
      <Link to="/compat-other" data-compat="link">other</Link>
    </main>
  );
}
`;

const OTHER_PAGE = String.raw`import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/compat-other")({
  loader: () => ({ at: "other" }),
  component: () => <p data-compat="other">{Route.useLoaderData().at}</p>,
});
`;

const REDIRECT_PAGE = String.raw`import { createFileRoute, redirect } from "@tanstack/react-router";

export const Route = createFileRoute("/compat-redirect")({
  beforeLoad: () => {
    throw redirect({ to: "/compat-other" });
  },
});
`;

const ERROR_PAGE = String.raw`import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/compat-error")({
  loader: () => {
    throw new Error("compat-loader-error");
  },
  errorComponent: ({ error }) => <p data-compat="error">caught {error.message}</p>,
  component: () => <p>unreachable</p>,
});
`;

const API_ROUTE = String.raw`import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/api/compat")({
  server: {
    handlers: {
      GET: async ({ request }) =>
        Response.json({ ok: true, method: "GET", q: new URL(request.url).searchParams.get("q") }),
      POST: async ({ request }) =>
        Response.json({ ok: true, method: "POST", body: await request.json() }),
    },
  },
});
`;

const API_REDIRECT_ROUTE = String.raw`import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/api/compat-redirect")({
  server: {
    handlers: {
      GET: async () => new Response(null, { status: 302, headers: { location: "/compat-other" } }),
    },
  },
});
`;

const ROBOTS_ROUTE = String.raw`import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/robots.txt")({
  server: {
    handlers: {
      GET: async () =>
        new Response("User-agent: *\nAllow: /\n", { headers: { "content-type": "text/plain; charset=utf-8" } }),
    },
  },
});
`;

export const NATIVE_COMPAT_FILES: readonly NativeCompatFile[] = [
  { path: "src/start.ts", content: START },
  { path: "src/compat/fns.ts", content: FNS },
  { path: "src/routes/compat.tsx", content: COMPAT_PAGE },
  { path: "src/routes/compat-other.tsx", content: OTHER_PAGE },
  { path: "src/routes/compat-redirect.tsx", content: REDIRECT_PAGE },
  { path: "src/routes/compat-error.tsx", content: ERROR_PAGE },
  { path: "src/routes/api/compat.ts", content: API_ROUTE },
  { path: "src/routes/api/compat-redirect.ts", content: API_REDIRECT_ROUTE },
  { path: "src/routes/robots[.]txt.ts", content: ROBOTS_ROUTE },
];

/**
 * Start's own cookie helpers, the way its documentation writes them. Kept
 * apart from the rest so a build that includes them says what they cost: they
 * use the request context, which the Live Preview cannot supply.
 */
export const NATIVE_COMPAT_COOKIE_HELPER_FILES: readonly NativeCompatFile[] = [
  {
    path: "src/routes/compat-cookies.tsx",
    content: String.raw`import { createFileRoute } from "@tanstack/react-router";
import { readCompatCookie } from "../compat/cookies";

export const Route = createFileRoute("/compat-cookies")({
  loader: async () => readCompatCookie(),
  component: () => <p data-compat="cookie">{JSON.stringify(Route.useLoaderData())}</p>,
});
`,
  },
  {
    path: "src/routes/api/compat-cookie.ts",
    content: String.raw`import { createFileRoute } from "@tanstack/react-router";
import { deleteCookie, getCookie, setCookie } from "@tanstack/react-start/server";

export const Route = createFileRoute("/api/compat-cookie")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const before = getCookie("compat_helper") ?? null;
        if (new URL(request.url).searchParams.has("clear")) {
          deleteCookie("compat_helper", { path: "/" });
        } else {
          setCookie("compat_helper", "set", { path: "/", httpOnly: true });
        }
        return Response.json({ before });
      },
    },
  },
});
`,
  },
  {
    path: "src/compat/cookies.ts",
    content: String.raw`import { createServerFn } from "@tanstack/react-start";
import { deleteCookie, getCookie, setCookie } from "@tanstack/react-start/server";

export const readCompatCookie = createServerFn({ method: "GET" }).handler(async () => ({
  value: getCookie("compat_helper") ?? null,
}));

export const writeCompatCookie = createServerFn({ method: "POST" }).handler(async () => {
  setCookie("compat_helper", "set", { path: "/", httpOnly: true });
  return { ok: true };
});

export const clearCompatCookie = createServerFn({ method: "POST" }).handler(async () => {
  deleteCookie("compat_helper", { path: "/" });
  return { ok: true };
});
`,
  },
];
