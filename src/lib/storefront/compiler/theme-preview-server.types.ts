import type {
  StartPreviewServerInput,
  StartPreviewServerResult,
} from "./cloudflare-sandbox-vite-preview-server";

/**
 * What a Live Preview server is, for the two transports that serve one.
 *
 * Theme builds already have this shape: `ThemeBuildRunner` is the contract, and
 * a local Vite runner and a Cloudflare Sandbox runner both satisfy it, chosen in
 * `theme-build-service.factory` by whether the environment has the bindings. The
 * preview server has only the sandbox implementation, which is why the editor's
 * end-to-end suite cannot run anywhere without a container — and why the same
 * contract is written here.
 *
 * The interface is deliberately the sandbox implementation's own surface:
 * `start`, `isServing`, `stop`, with the argument and result types it already
 * declares. A local transport is a second implementation of *this*, not a
 * different lifecycle, so the contract is only worth having if the existing
 * implementation satisfies it untouched — `theme-preview-server.contract.test`
 * fails to compile if it does not.
 *
 * What a green CI run proves, once a local transport exists: the editor works
 * against a local Vite server. It does **not** prove the sandbox path works,
 * because the sandbox is not what CI runs. The sandbox needs its own occasional
 * real run, exactly as it has today.
 *
 * What the second implementation still has to get right:
 *
 * - **A different origin from the editor.** `resolveLivePreviewSecurity` refuses
 *   a user-code preview on the editor's own origin, and that check reads a
 *   *configured* value — so the transport has to make sure what it hands over is
 *   the origin actually served, not a default that happens to be nearby.
 *   `LocalVitePreviewServer` answers this by binding loopback and nothing else,
 *   which is a boundary a configured hostname cannot widen; the sandbox answers
 *   it by refusing every platform hostname before it starts a container.
 * - **Selected by binding presence, not by a flag.** The build plane picks its
 *   runner in `theme-build-service.factory` on whether the environment has the
 *   bindings; `theme-preview-server.factory` picks the transport the same way,
 *   so a deployment cannot end up running the local transport: the `Sandbox`
 *   binding is read first, and the local variables are not even looked at when
 *   it is present.
 * - **A parity harness.** Two implementations of one contract drift, and CI only
 *   ever exercises one of them. `workspace-theme-parity.test.ts` exists for
 *   exactly this reason between the interpreter and the real build;
 *   `theme-preview-server-parity.test.ts` is the same insurance between these
 *   two, and it states plainly what it cannot cover without a container.
 *
 * One capability is deliberately *not* here. The sandbox path writes edited files
 * by reaching into its container from the server function that already holds the
 * binding, so file application never had to travel through this contract; a
 * sidecar's filesystem is in another process, so the local path does have to ask.
 * That is carried on the sidecar protocol (`local-preview-sidecar.protocol.ts`)
 * rather than widened into this type, because widening it would mean changing the
 * sandbox implementation to fit — which is the thing the contract exists to
 * prove is unnecessary. If a second capability ever needs the same treatment,
 * that is the signal to revisit this decision rather than to add a second side
 * channel.
 */
export type ThemePreviewServer = Readonly<{
  start(input: StartPreviewServerInput): Promise<StartPreviewServerResult>;
  /**
   * Whether the server behind an already-framed address is still there.
   *
   * A loaded preview page keeps answering the editor's heartbeat after its
   * container is gone, so this has to ask the server rather than the page.
   */
  isServing(input: {
    previewId: string;
    previewHostname: string;
    expectedOrigin?: string | null;
  }): Promise<boolean>;
  stop(previewId: string, processId?: string): Promise<void>;
}>;

export type { StartPreviewServerInput, StartPreviewServerResult };
