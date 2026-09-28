import type { Page, Request } from "@playwright/test";

/**
 * A manual performance probe for opening the editor: every request's timing,
 * and where the Live Preview's module requests come from.
 *
 * Off unless `MORPH_E2E_TIMELINE=1`. It asserts nothing and CI never turns it
 * on: a suite that failed on a number would fail on the machine's load as
 * often as on a regression. It is for before/after comparisons of the same
 * change in the same environment, several runs each — how the preview
 * pre-bundling of `@tanstack/router-core` was measured.
 *
 * What it prints, prefixed `[timeline]`:
 * - when each `openEditor` stage finished;
 * - the preview's requests: count, peak concurrency, and per request the time
 *   queued in the browser, the time to first byte, and the download;
 * - the same requests by origin: Theme source, pre-bundled dependencies,
 *   toolchain packages served unbundled (by package), Vite's virtual modules;
 * - every request that loaded the preview document itself, so a full reload
 *   (for instance a dependency discovered while running) is visible.
 */
export function startRequestTimeline(page: Page) {
  if (process.env.MORPH_E2E_TIMELINE !== "1") return null;
  const startedAt = Date.now();
  type Entry = {
    url: string;
    start: number;
    end?: number;
    queued?: number;
    firstByte?: number;
    download?: number;
    failed?: string;
  };
  const entries = new Map<Request, Entry>();
  const marks: [string, number][] = [];
  const now = () => Date.now() - startedAt;

  const onRequest = (request: Request) =>
    entries.set(request, { url: request.url(), start: now() });
  const onFinished = (request: Request) => {
    const entry = entries.get(request);
    if (!entry) return;
    entry.end = now();
    const timing = request.timing();
    if (timing.requestStart >= 0 && timing.responseStart >= 0) {
      entry.queued = timing.requestStart;
      entry.firstByte = timing.responseStart - timing.requestStart;
      entry.download = timing.responseEnd - timing.responseStart;
    }
  };
  const onFailed = (request: Request) => {
    const entry = entries.get(request);
    if (!entry) return;
    entry.end = now();
    entry.failed = request.failure()?.errorText ?? "failed";
  };
  page.on("request", onRequest);
  page.on("requestfinished", onFinished);
  page.on("requestfailed", onFailed);

  const percentile = (values: number[], q: number) => {
    const sorted = [...values].sort((a, b) => a - b);
    return Math.round(
      sorted[Math.min(sorted.length - 1, Math.floor(q * sorted.length))] ?? -1,
    );
  };
  const pathOf = (url: string) => url.replace(/^https?:\/\/[^/]+/, "");
  const originOf = (url: string) => {
    const path = pathOf(url);
    const unbundled =
      /\/@fs\/opt\/morph-toolchain\/node_modules\/((?:@[^/]+\/)?[^/]+)/.exec(
        path,
      );
    if (unbundled) return `unbundled:${unbundled[1]}`;
    if (path.includes("/node_modules/.vite/deps/")) return "pre-bundled";
    if (/^\/__morph-theme-preview__\/src\//.test(path)) return "theme-source";
    if (/\/@(id|vite|react-refresh)/.test(path)) return "vite-virtual";
    return "other";
  };

  return {
    mark(stage: string) {
      marks.push([stage, now()]);
    },
    report() {
      page.off("request", onRequest);
      page.off("requestfinished", onFinished);
      page.off("requestfailed", onFailed);
      const all = [...entries.values()];
      const editorOrigin = new URL(page.url()).origin;
      const preview = all.filter(
        (entry) =>
          !entry.url.startsWith(editorOrigin) && !entry.url.startsWith("data:"),
      );
      const log = (line: string) => console.log(`[timeline] ${line}`);
      log(`marks ${marks.map(([stage, at]) => `${stage}@${at}`).join(" ")}`);
      if (preview.length === 0) return;
      let peak = 0;
      for (const entry of preview) {
        peak = Math.max(
          peak,
          preview.filter(
            (other) =>
              other.start <= entry.start &&
              (other.end ?? Infinity) > entry.start,
          ).length,
        );
      }
      log(
        `preview requests ${preview.length}, first ${Math.min(...preview.map((e) => e.start))}, last end ${Math.max(...preview.map((e) => e.end ?? 0))}, peak concurrency ${peak}, failed ${preview.filter((e) => e.failed).length}`,
      );
      const timed = preview.filter((entry) => entry.firstByte !== undefined);
      for (const [label, values] of [
        ["queued in browser", timed.map((e) => e.queued!)],
        ["to first byte", timed.map((e) => e.firstByte!)],
        ["download", timed.map((e) => e.download!)],
      ] as const) {
        log(
          `${label}: p50 ${percentile([...values], 0.5)} p90 ${percentile([...values], 0.9)} max ${percentile([...values], 1)}`,
        );
      }
      const groups = new Map<string, { n: number; lastEnd: number }>();
      for (const entry of preview) {
        const key = originOf(entry.url);
        const group = groups.get(key) ?? { n: 0, lastEnd: 0 };
        group.n += 1;
        group.lastEnd = Math.max(group.lastEnd, entry.end ?? 0);
        groups.set(key, group);
      }
      for (const [key, group] of [...groups].sort((a, b) => b[1].n - a[1].n)) {
        log(`origin ${key} n ${group.n} last end ${group.lastEnd}`);
      }
      for (const entry of preview.filter((e) =>
        /^\/__morph-theme-preview__\/?(\?|$)/.test(pathOf(e.url)),
      )) {
        log(`preview document at ${entry.start}`);
      }
    },
  };
}
