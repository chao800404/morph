/**
 * Names the component behind React's "Maximum update depth exceeded".
 *
 * React's console message carries no stack, so an E2E run that logged it 17
 * times on the editor page could not say which component looped. This wraps
 * `console.error` in the page and, when the message mentions the warning,
 * logs the JS stack at that moment on a separate `console.log` line that the
 * crash reporter in helpers.ts prints.
 *
 * Content-free on purpose: stack frames only, never the arguments. Bounded: at
 * most `MAX_STACKS` stacks per page and `MAX_FRAMES` frames each. It only
 * observes. The original `console.error` is always called, and anything the
 * wrapper itself throws is swallowed, so it cannot change or fail a test.
 */
export const UPDATE_DEPTH_STACK_PREFIX = "[editor update-depth stack] ";

export interface UpdateDepthStackOptions {
  /** Only the editor page, never the preview iframe's origin. */
  editorOrigin: string | null;
  prefix: string;
  maxStacks: number;
  maxFrames: number;
}

/** Runs inside the browser; must stay self-contained (it is serialised). */
export function installUpdateDepthStack(options: UpdateDepthStackOptions) {
  try {
    if (window.top !== window) return;
    if (options.editorOrigin && location.origin !== options.editorOrigin) {
      return;
    }
    const original = console.error;
    let left = options.maxStacks;
    console.error = function (...args: unknown[]) {
      try {
        if (left > 0) {
          const first = args[0];
          if (
            typeof first === "string" &&
            first.indexOf("Maximum update depth") !== -1
          ) {
            left -= 1;
            const frames = String(new Error().stack ?? "")
              .split("\n")
              .slice(0, options.maxFrames + 1)
              .join("\n");
            console.log(options.prefix + frames);
          }
        }
      } catch {
        // Observation only.
      }
      return original.apply(this, args as []);
    };
  } catch {
    // Observation only.
  }
}

/** Origin of the editor URL, or null when it cannot be resolved yet. */
export function editorOriginOf(
  editorPath: string,
  baseURL: string | undefined,
): string | null {
  try {
    return new URL(editorPath, baseURL).origin;
  } catch {
    return null;
  }
}
