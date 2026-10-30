import { observedPreviewNamespace } from "./preview-sandbox-cause-observation";

/**
 * The binding Live Preview containers live under: `PreviewSandbox`, never the
 * `Sandbox` that builds and deployments use, whose policy is not the
 * preview's. See `src/server/preview-sandbox.ts`.
 *
 * Every Live Preview caller reaches it through here, so all of them hold the
 * same observed namespace; see `preview-sandbox-cause-observation.ts`.
 */
export function previewSandboxBinding(
  env: Record<string, unknown> | undefined,
): unknown {
  return observedPreviewNamespace(env?.PreviewSandbox);
}

/**
 * `proxyToSandbox` looks for its namespace at `env.Sandbox`; this hands it the
 * preview's namespace under that name.
 */
export function previewProxyEnv(
  env: Record<string, unknown> | undefined,
): { Sandbox: unknown } {
  return { Sandbox: previewSandboxBinding(env) };
}
