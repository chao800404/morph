import type { NativeCompatFile } from "./native-compat-theme";

/** Ordinary Start authoring, shared by dev-server and built-Worker acceptance. */
export const NATIVE_COMPAT_ADVANCED_FILES: readonly NativeCompatFile[] = [
  {
    path: "tsconfig.json",
    content: JSON.stringify({
      compilerOptions: {
        baseUrl: ".",
        paths: { "@/*": ["src/*"], "@compat/*": ["src/compat/*"] },
      },
    }),
  },
  {
    path: "src/compat/deferred-state.ts",
    content: String.raw`const pending = new Map<string, () => void>();
export function deferredValue(id: string) {
  if (pending.has(id)) throw new Error('duplicate deferred fixture');
  return new Promise<string>((resolve, reject) => {
    const timer = setTimeout(() => {
      pending.delete(id);
      reject(new Error('deferred fixture timeout'));
    }, 30_000);
    pending.set(id, () => {
      clearTimeout(timer);
      pending.delete(id);
      resolve('deferred:中文');
    });
  });
}
export function releaseDeferred(id: string) {
  const release = pending.get(id);
  if (!release) return false;
  release();
  return true;
}
`,
  },
  {
    path: "src/routes/compat-deferred.tsx",
    content: String.raw`import { useEffect, useState } from 'react';
import { Await, createFileRoute } from '@tanstack/react-router';
import { createServerFn } from '@tanstack/react-start';
import { getRequest } from '@tanstack/react-start/server';
import { deferredValue } from '@compat/deferred-state';
const readDeferred = createServerFn({ method: 'GET' }).handler(async () => ({
  fast: 'shell:ready',
  slow: deferredValue(new URL(getRequest().url).searchParams.get('id') ?? 'browser'),
}));
export const Route = createFileRoute('/compat-deferred')({
  loader: () => readDeferred(),
  component: Page,
});
function Page() {
  const data = Route.useLoaderData();
  const [hydrated, setHydrated] = useState(false);
  useEffect(() => setHydrated(true), []);
  return <main data-deferred-hydrated={hydrated}><p data-deferred="shell">{data.fast}</p>
    <Await promise={data.slow} fallback={<p data-deferred="pending">Waiting</p>}>
      {(value) => <p data-deferred="result">{value}</p>}
    </Await>
  </main>;
}
`,
  },
  {
    path: "src/routes/api/compat-deferred-release.ts",
    content: String.raw`import { createFileRoute } from '@tanstack/react-router';
import { releaseDeferred } from '@compat/deferred-state';
export const Route = createFileRoute('/api/compat-deferred-release')({ server: { handlers: {
  POST: ({ request }) => Response.json({ released: releaseDeferred(new URL(request.url).searchParams.get('id') ?? 'browser') }),
} } });
`,
  },
  {
    path: "src/compat/amount.ts",
    content: String.raw`import { createSerializationAdapter } from '@tanstack/react-router';
export class CompatAmount {
  constructor(public cents: number) {}
  describe() { return 'amount:' + this.cents; }
}
export const amountAdapter = createSerializationAdapter({
  key: 'compat-amount',
  test: (value): value is CompatAmount => value instanceof CompatAmount,
  toSerializable: (value) => ({ cents: value.cents }),
  fromSerializable: ({ cents }) => new CompatAmount(cents),
});
`,
  },
  {
    path: "src/compat/advanced-fns.ts",
    content: String.raw`import { createServerFn } from '@tanstack/react-start';
import { CompatAmount } from '@compat/amount';
export const getAmount = createServerFn({ method: 'GET' })
  .handler(async () => new CompatAmount(1234));
export const echoAmount = createServerFn({ method: 'POST' })
  .inputValidator((data: CompatAmount) => data)
  .handler(async ({ data }) => ({
    instance: data instanceof CompatAmount,
    description: data.describe(),
  }));
`,
  },
  {
    path: "src/routes/compat-advanced.tsx",
    content: String.raw`import { useState } from 'react';
import { createFileRoute } from '@tanstack/react-router';
import { CompatAmount } from '@compat/amount';
import { getAmount, echoAmount } from '@compat/advanced-fns';
export const Route = createFileRoute('/compat-advanced')({
  loader: async () => ({ amount: await getAmount() }),
  component: Page,
});
function Page() {
  const { amount } = Route.useLoaderData();
  const [result, setResult] = useState('idle');
  return <main data-advanced-url={getAmount.url}>
    <p data-advanced="loader">{String(amount instanceof CompatAmount) + ':' + amount.describe()}</p>
    <button data-advanced="get" onClick={async () => {
      const value = await getAmount();
      setResult(String(value instanceof CompatAmount) + ':' + value.describe());
    }}>Get amount</button>
    <button data-advanced="post" onClick={async () => {
      setResult(JSON.stringify(await echoAmount({ data: new CompatAmount(5678) })));
    }}>Send amount</button>
    <p data-advanced="result">{result}</p>
  </main>;
}
`,
  },
];
