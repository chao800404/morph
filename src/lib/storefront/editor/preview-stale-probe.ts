/**
 * Noticing, while a Live Preview frame loads, that its address went stale.
 *
 * A container restart leaves the preview address answering
 * `410 STALE_PREVIEW_URL` until the next start exposes the port again. A frame
 * loading in that window never announces itself, and the editor used to find
 * out only when its 45 second load timeout ran out.
 *
 * Two signals lead to asking the server, and only the server's answer acts:
 *
 * - Time. A frame that has not announced itself a few seconds in is checked,
 *   and checked again every few seconds. This covers a page whose own
 *   request was refused, where nothing inside the frame runs to say so.
 * - A hint. The frame's diagnostic script reports refused requests; that
 *   brings the next check forward. It is only a hint: the frame runs Theme
 *   JavaScript, so a message from it can be forged, and it can report
 *   failures that have nothing to do with the container.
 *
 * A slow first load is not a stale address — compiling a Theme cold can take
 * well over ten seconds — so "serving" keeps waiting, "unknown" keeps
 * waiting, and only "stale" is reported, once.
 */

export type PreviewProbeAnswer = "serving" | "stale" | "unknown";

export const PREVIEW_PROBE_FIRST_MS = 5_000;
export const PREVIEW_PROBE_INTERVAL_MS = 4_000;
/** Hints closer together than this share one check. */
export const PREVIEW_PROBE_HINT_GAP_MS = 2_000;

export type PreviewStaleProbe = Readonly<{
  /** The frame reported something worth checking now rather than later. */
  hint(): void;
  stop(): void;
}>;

export function startPreviewStaleProbe(options: {
  probe: () => Promise<PreviewProbeAnswer>;
  onStale: () => void;
  firstMs?: number;
  intervalMs?: number;
  hintGapMs?: number;
  now?: () => number;
}): PreviewStaleProbe {
  const firstMs = options.firstMs ?? PREVIEW_PROBE_FIRST_MS;
  const intervalMs = options.intervalMs ?? PREVIEW_PROBE_INTERVAL_MS;
  const hintGapMs = options.hintGapMs ?? PREVIEW_PROBE_HINT_GAP_MS;
  const now = options.now ?? Date.now;

  let stopped = false;
  let inFlight = false;
  let lastCheckAt = Number.NEGATIVE_INFINITY;
  let timer: ReturnType<typeof setTimeout> | undefined;

  const schedule = (delayMs: number) => {
    clearTimeout(timer);
    timer = setTimeout(() => void check(), delayMs);
  };

  const check = async () => {
    if (stopped || inFlight) return;
    inFlight = true;
    lastCheckAt = now();
    let answer: PreviewProbeAnswer;
    try {
      answer = await options.probe();
    } catch {
      answer = "unknown";
    } finally {
      inFlight = false;
    }
    if (stopped) return;
    if (answer === "stale") {
      stopped = true;
      clearTimeout(timer);
      options.onStale();
      return;
    }
    schedule(intervalMs);
  };

  schedule(firstMs);

  return {
    hint() {
      if (stopped || inFlight) return;
      if (now() - lastCheckAt < hintGapMs) return;
      clearTimeout(timer);
      void check();
    },
    stop() {
      stopped = true;
      clearTimeout(timer);
    },
  };
}
