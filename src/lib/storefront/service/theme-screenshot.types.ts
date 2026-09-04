export interface ThemeScreenshotRequest {
  /** Fully-qualified, publicly reachable URL. */
  url: string;
  width: number;
  height: number;
}

/**
 * Captures a rendered page as PNG bytes.
 *
 * A port rather than a direct call because capture is optional infrastructure:
 * it needs credentials the deployment may not have, and it reaches a network
 * service that costs money and can be slow. Behind an interface the publish
 * path can run with no screenshotter at all, and the tests can exercise the
 * whole flow without one.
 */
export interface ThemeScreenshotter {
  capture(request: ThemeScreenshotRequest): Promise<Uint8Array>;
}
