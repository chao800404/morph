/**
 * The Live Preview's outbound policy: deny by default, and say so.
 *
 * A preview container runs Theme code, and gets no internet of its own
 * (`enableInternet = false`). Its HTTP and HTTPS requests on ports 80 and 443
 * are handed to this policy, which runs in the Worker, outside the container,
 * where Theme code cannot change it. Every one is refused, with an answer that
 * names the preview's policy — so a Theme that calls an API sees why, instead
 * of a connection that hangs, and is not led to think TanStack Start itself
 * lacks the feature. Other ports are refused by the network before anything
 * reaches here.
 *
 * What this is not: network isolation. DNS still resolves, through
 * Cloudflare's resolvers, so a name looked up can carry a little data out; and
 * none of this separates Theme code from anything else inside its own
 * container. The allow list is empty for now; opening it to named destinations
 * is later work.
 */

export const PREVIEW_EGRESS_DENIED = "PREVIEW_EGRESS_DENIED";
export const PREVIEW_EGRESS_HEADER = "x-morph-preview-egress";

export function refusePreviewEgress(
  request: Request,
  containerId: string,
  log: (line: string) => void = (line) => console.warn(line),
): Response {
  const method = describeMethod(request.method);
  const destination = describeDestination(request.url);
  recordRefusal(containerId, method, destination, log);
  return new Response(
    `Live Preview outbound policy refused ${method} ${destination} (${PREVIEW_EGRESS_DENIED}). ` +
      "Theme server code in the Live Preview cannot reach other hosts. " +
      "This is Morph's preview policy, not a limit of TanStack Start.\n",
    {
      status: 403,
      headers: {
        "content-type": "text/plain; charset=utf-8",
        "cache-control": "no-store",
        [PREVIEW_EGRESS_HEADER]: PREVIEW_EGRESS_DENIED,
      },
    },
  );
}

/** A method as a short token; anything else is `OTHER`. */
function describeMethod(method: string): string {
  return /^[A-Z]{1,16}$/.test(method) ? method : "OTHER";
}

/**
 * Scheme, host and port only: never a path, a query or credentials, which is
 * where a request carries what it is sending.
 */
function describeDestination(rawUrl: string): string {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    return "unknown";
  }
  const scheme = url.protocol === "https:" ? "https" : "http";
  const host =
    url.hostname
      .toLowerCase()
      .replace(/[^a-z0-9.\-:[\]]/g, "")
      .slice(0, 253) || "unknown";
  const port = /^\d{1,5}$/.test(url.port) ? `:${url.port}` : "";
  return `${scheme}://${host}${port}`;
}

/**
 * At most `PER_WINDOW` lines per container per minute and `PER_CONTAINER` in
 * all; past either, refusals are counted and one line says how many went
 * unrecorded. Kept per Worker isolate, so the bounds hold per isolate, which is
 * what keeps a Theme from turning outbound calls into a log flood.
 */
const WINDOW_MS = 60_000;
const PER_WINDOW = 20;
const PER_CONTAINER = 200;
const MAX_TRACKED = 1_000;

type Tally = {
  windowStart: number;
  inWindow: number;
  logged: number;
  suppressed: number;
};

const tallies = new Map<string, Tally>();

function recordRefusal(
  containerId: string,
  method: string,
  destination: string,
  log: (line: string) => void,
  now: number = Date.now(),
): void {
  try {
    const key = containerId.slice(0, 128);
    let tally = tallies.get(key);
    if (!tally) {
      if (tallies.size >= MAX_TRACKED) {
        const oldest = tallies.keys().next().value;
        if (oldest !== undefined) tallies.delete(oldest);
      }
      tally = { windowStart: now, inWindow: 0, logged: 0, suppressed: 0 };
      tallies.set(key, tally);
    }
    if (now - tally.windowStart >= WINDOW_MS) {
      if (tally.suppressed > 0 && tally.logged < PER_CONTAINER) {
        log(line(key, { suppressed: tally.suppressed }));
        tally.logged += 1;
        tally.suppressed = 0;
      }
      tally.windowStart = now;
      tally.inWindow = 0;
    }
    if (tally.inWindow >= PER_WINDOW || tally.logged >= PER_CONTAINER) {
      tally.suppressed += 1;
      return;
    }
    tally.inWindow += 1;
    tally.logged += 1;
    log(line(key, { method, destination }));
  } catch {
    // A refusal is answered whether or not it could be recorded.
  }
}

function line(containerId: string, detail: Record<string, unknown>): string {
  return JSON.stringify({
    scope: "storefront.preview.egress",
    code: PREVIEW_EGRESS_DENIED,
    containerId,
    ...detail,
  });
}

/** For tests: forget every tally. */
export function resetPreviewEgressTallies(): void {
  tallies.clear();
}
