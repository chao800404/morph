import type { NativeCompatFile } from "./native-compat-theme";

/** Framework-owned entry conventions and route-level rendering options. */
export const NATIVE_COMPAT_ENTRY_FILES: readonly NativeCompatFile[] = [
  {
    path: "src/server.ts",
    content: String.raw`import { createServerEntry } from '@tanstack/react-start/server-entry';
import { createStartHandler, defaultStreamHandler, defineHandlerCallback } from '@tanstack/react-start/server';
const render = defineHandlerCallback(async (context) => {
  context.responseHeaders.set('x-compat-renderer', 'custom-stream');
  return defaultStreamHandler(context);
});
const handle = createStartHandler(render);
export default createServerEntry({
  async fetch(request, options) {
    const response = await handle(request, options);
    response.headers.set('x-compat-server-entry', 'theme');
    return response;
  },
});
`,
  },
  {
    path: "src/client.tsx",
    content: String.raw`import { startTransition, useEffect } from 'react';
import { hydrateRoot } from 'react-dom/client';
import { StartClient } from '@tanstack/react-start/client';
window.__compatClientEntryRuns = (window.__compatClientEntryRuns ?? 0) + 1;
function Client() {
  useEffect(() => {
    document.documentElement.dataset.compatClientEntry = 'ready';
  }, []);
  return <StartClient />;
}
startTransition(() => hydrateRoot(document, <Client />));
`,
  },
  {
    path: "src/routes/compat-ssr-off.tsx",
    content: String.raw`import { createFileRoute } from '@tanstack/react-router';
import { createServerFn } from '@tanstack/react-start';
import { setResponseHeader } from '@tanstack/react-start/server';
const read = createServerFn({ method: 'GET' }).handler(() => {
  setResponseHeader('x-compat-off-loader', 'ran');
  return { value: 'off-loader-ran' };
});
export const Route = createFileRoute('/compat-ssr-off')({
  ssr: false,
  loader: () => read(),
  pendingComponent: () => <p data-selective="off-pending">Off pending</p>,
  component: Page,
});
function Page() {
  const data = Route.useLoaderData();
  return <main data-selective="off">{'off:' + data.value + ':' + window.location.pathname}</main>;
}
`,
  },
  {
    path: "src/routes/compat-ssr-data.tsx",
    content: String.raw`import { createFileRoute } from '@tanstack/react-router';
import { createServerFn } from '@tanstack/react-start';
import { setResponseHeader } from '@tanstack/react-start/server';
const read = createServerFn({ method: 'GET' }).handler(() => {
  setResponseHeader('x-compat-data-loader', 'ran');
  return { value: 'data-loader-ran' };
});
export const Route = createFileRoute('/compat-ssr-data')({
  ssr: 'data-only',
  loader: () => read(),
  pendingComponent: () => <p data-selective="data-pending">Data pending</p>,
  component: Page,
});
function Page() {
  const data = Route.useLoaderData();
  const location = typeof window === 'undefined' ? 'server-component-ran' : window.location.pathname;
  return <main data-selective="data">{'data:' + data.value + ':' + location}</main>;
}
`,
  },
];
