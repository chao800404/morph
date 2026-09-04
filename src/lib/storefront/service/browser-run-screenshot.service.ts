import type {
  ThemeScreenshotRequest,
  ThemeScreenshotter,
} from "./theme-screenshot.types";

export interface BrowserRunScreenshotOptions {
  accountId: string;
  apiToken: string;
  /** Injected so tests never reach the network. */
  fetchImpl?: typeof fetch;
  /** Give up rather than hold a queue message open indefinitely. */
  timeoutMs?: number;
}

const DEFAULT_TIMEOUT_MS = 45_000;
const ENDPOINT = "https://api.cloudflare.com/client/v4/accounts";

/**
 * Captures a page through Cloudflare Browser Run's REST API.
 *
 * The REST endpoint is used rather than the Workers browser binding for two
 * reasons: the binding's `quickAction()` needs a compatibility date far ahead
 * of this Worker's, and a binding session that is not explicitly closed keeps
 * burning browser time until it times out. One request per capture has no
 * session to leak.
 */
export class BrowserRunScreenshotter implements ThemeScreenshotter {
  private readonly accountId: string;
  private readonly apiToken: string;
  private readonly fetchImpl: typeof fetch;
  private readonly timeoutMs: number;

  constructor(options: BrowserRunScreenshotOptions) {
    this.accountId = options.accountId;
    this.apiToken = options.apiToken;
    this.fetchImpl = options.fetchImpl ?? fetch;
    this.timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  }

  async capture(request: ThemeScreenshotRequest): Promise<Uint8Array> {
    const signal = AbortSignal.timeout(this.timeoutMs);
    const response = await this.fetchImpl(
      `${ENDPOINT}/${this.accountId}/browser-rendering/screenshot`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${this.apiToken}`,
          "Content-Type": "application/json",
        },
        signal,
        body: JSON.stringify({
          url: request.url,
          viewport: {
            width: request.width,
            height: request.height,
            // The card renders these small; at scale 1 the text in them is
            // unreadable on a high-density display.
            deviceScaleFactor: 2,
          },
          // Only the first screenful is shown in the card, and a full-page
          // capture of a long storefront is mostly footer.
          screenshotOptions: { fullPage: false },
          gotoOptions: { waitUntil: "networkidle0", timeout: 30_000 },
        }),
      },
    );

    if (!response.ok) {
      // The body carries Cloudflare's reason (bad token, 429 daily cap, a page
      // that would not load). Losing it would leave every failure looking the
      // same in the logs.
      const detail = await response.text().catch(() => "");
      throw new Error(
        `Browser Run screenshot failed (${response.status}): ${detail.slice(0, 300)}`,
      );
    }

    return new Uint8Array(await response.arrayBuffer());
  }
}

/**
 * Builds a screenshotter, or reports why there is none.
 *
 * Returns `null` rather than throwing when credentials are absent: capture is
 * optional, and a deployment without a token should publish normally with no
 * picture, not fail to publish.
 */
export function createBrowserRunScreenshotter(env: {
  CLOUDFLARE_ACCOUNT_ID?: unknown;
  BROWSER_RENDERING_API_TOKEN?: unknown;
}): ThemeScreenshotter | null {
  const accountId = env.CLOUDFLARE_ACCOUNT_ID;
  const apiToken = env.BROWSER_RENDERING_API_TOKEN;
  if (typeof accountId !== "string" || accountId.length === 0) return null;
  if (typeof apiToken !== "string" || apiToken.length === 0) return null;
  return new BrowserRunScreenshotter({ accountId, apiToken });
}
