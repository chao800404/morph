import type { NativeCompatFile } from "./native-compat-theme";

/** Ordinary Theme code; the release route is a fixture-only deterministic gate. */
export const NATIVE_COMPAT_TRANSPORT_FILES: readonly NativeCompatFile[] = [
  {
    path: "src/compat/transport-state.ts",
    content: String.raw`const releases = new Map<string, () => void>();
export function controlledStream(id: string, typed = false) {
  if (releases.has(id)) throw new Error('compat-transport-server-only-sentinel');
  let timer: ReturnType<typeof setTimeout>;
  return new ReadableStream({
    async start(controller) {
      const encode = (text: string) => typed ? { text } : new TextEncoder().encode(text);
      controller.enqueue(encode('first:中文\n'));
      try {
        await new Promise<void>((resolve, reject) => {
          // Pending I/O keeps workerd from treating an in-memory-only gate as
          // a permanently hung request. Timeout fails, never releases data.
          timer = setTimeout(() => reject(new Error('fixture release timeout')), 30_000);
          releases.set(id, resolve);
        });
        controller.enqueue(encode('second:done\n'));
        controller.close();
      } catch (error) { controller.error(error); }
      finally {
        clearTimeout(timer);
        releases.delete(id);
      }
    },
    cancel() { clearTimeout(timer); releases.delete(id); },
  });
}
export function releaseStream(id: string) {
  const release = releases.get(id);
  if (!release) return false;
  release();
  return true;
}
`,
  },
  {
    path: "src/compat/transport-fns.ts",
    content: String.raw`import { createServerFn } from '@tanstack/react-start';
import { getRequest } from '@tanstack/react-start/server';
import { controlledStream } from './transport-state';
export const rawResponse = createServerFn({ method: 'GET' }).handler(async () =>
  new Response(new Uint8Array([0, 1, 127, 255]), {
    status: 206,
    headers: { 'content-type': 'application/octet-stream', 'x-compat-raw': 'yes' },
  }),
);
export const multipart = createServerFn({ method: 'POST' })
  .inputValidator((data: FormData) => data)
  .handler(async ({ data }) => {
    const file = data.get('file') as File;
    return Response.json({ title: data.get('title'), tags: data.getAll('tag'),
      filename: file.name, mime: file.type, size: file.size,
      bytes: Array.from(new Uint8Array(await file.arrayBuffer())) });
  });
export const byteStream = createServerFn({ method: 'GET' })
  .handler(async () => new Response(controlledStream(getRequest().headers.get('x-compat-stream-id')!), {
    headers: { 'content-type': 'text/plain; charset=utf-8' },
  }));
export const typedStream = createServerFn({ method: 'GET' })
  .handler(async () => controlledStream(getRequest().headers.get('x-compat-stream-id')!, true));
`,
  },
  {
    path: "src/routes/api/compat-stream-release.ts",
    content: String.raw`import { createFileRoute } from '@tanstack/react-router';
import { releaseStream } from '../../compat/transport-state';
export const Route = createFileRoute('/api/compat-stream-release')({ server: { handlers: {
  POST: ({ request }) => Response.json({ released: releaseStream(new URL(request.url).searchParams.get('id') ?? '') }),
} } });
`,
  },
  {
    path: "src/routes/compat-transport.tsx",
    content: String.raw`import { useState } from 'react';
import { createFileRoute } from '@tanstack/react-router';
import { rawResponse, multipart, byteStream, typedStream } from '../compat/transport-fns';
export const Route = createFileRoute('/compat-transport')({ component: TransportPage });
function TransportPage() {
  const [result, setResult] = useState('idle');
  const [id, setId] = useState('');
  const [phase, setPhase] = useState('idle');
  async function run(action: () => Promise<void>) {
    try { await action(); } catch (error) { setResult('error:' + String(error)); setPhase('error'); }
  }
  async function stream(typed: boolean) {
    const key = crypto.randomUUID(); setId(key); setResult(''); setPhase('loading');
    const options = { headers: { 'x-compat-stream-id': key } };
    const response = typed ? await typedStream(options) : await byteStream(options);
    const reader = (typed ? response : (response as Response).body!).getReader();
    const decoder = new TextDecoder();
    while (true) {
      const next = await reader.read();
      if (next.done) break;
      const text = typed ? next.value.text : decoder.decode(next.value, { stream: true });
      setResult((previous) => previous + text); setPhase('partial');
    }
    setPhase('done');
  }
  return <main>
    <button data-transport="raw" onClick={() => run(async () => {
      const response = await rawResponse();
      setResult(JSON.stringify({ status: response.status, mime: response.headers.get('content-type'),
        marker: response.headers.get('x-compat-raw'), bytes: Array.from(new Uint8Array(await response.arrayBuffer())) }));
    })}>raw</button>
    <button data-transport="form" onClick={() => run(async () => {
      const data = new FormData(); data.append('title', '中文'); data.append('tag', 'a'); data.append('tag', 'b');
      data.append('file', new File([new Uint8Array([0, 1, 127, 255])], 'fixture.bin', { type: 'application/octet-stream' }));
      setResult(JSON.stringify(await (await multipart({ data })).json()));
    })}>form</button>
    <button data-transport="bytes" onClick={() => run(() => stream(false))}>bytes</button>
    <button data-transport="typed" onClick={() => run(() => stream(true))}>typed</button>
    <output data-transport="urls" data-raw-url={rawResponse.url} data-form-url={multipart.url} data-stream-url={byteStream.url} />
    <output data-transport="id">{id}</output>
    <output data-transport="phase">{phase}</output>
    <output data-transport="result">{result}</output>
  </main>;
}
`,
  },
];
