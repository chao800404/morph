/** A real local server-only dependency, shared by preview and build acceptance. */
export const SERVER_HELPER_SENTINEL = "MORPH_SERVER_ONLY_BOUNDARY_SENTINEL";
export const NATIVE_COMPAT_SERVER_HELPER_FILES = [
  {
    path: "src/private-data.server.ts",
    content: `import { getRequestHeader } from "@tanstack/react-start/server";
export function readPrivateData() {
  return getRequestHeader("x-private-case") === "${SERVER_HELPER_SENTINEL}"
    ? "private-branch" : "server-helper-ran";
}`,
  },
  {
    path: "src/routes/server-helper.tsx",
    content: `import { createFileRoute } from "@tanstack/react-router";
import { createServerFn } from "@tanstack/react-start";
import { useState } from "react";
import { readPrivateData } from "../private-data.server";
const read = createServerFn({ method: "GET" }).handler(() =>
  new Response(readPrivateData(), { headers: { "content-type": "text/plain" } }));
function HelperPage() {
  const [result, setResult] = useState("");
  return <p data-helper-url={read.url}>server helper fixture
    <button data-helper-read onClick={async () => setResult(await (await read()).text())}>Read server helper</button>
    <span data-helper-result>{result}</span>
  </p>;
}
export const Route = createFileRoute("/server-helper")({
  component: HelperPage,
});`,
  },
] as const;
