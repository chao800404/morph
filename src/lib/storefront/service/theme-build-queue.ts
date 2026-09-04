import { z } from "zod";

const themeBuildQueueMessageSchema = z.object({
  version: z.literal(1),
  type: z.literal("theme-build"),
  storefrontId: z.string().uuid(),
  themeId: z.string().uuid(),
  buildId: z.string().uuid(),
});

export type ThemeBuildQueueMessage = z.infer<
  typeof themeBuildQueueMessageSchema
>;

/**
 * Capture what a release looks like, after it exists.
 *
 * Queued rather than done inline because a capture reaches an external
 * rendering service that is slow and rate-limited, and a release is already
 * durable by the time this is sent. Holding publish open for a picture would
 * make a cosmetic step able to fail a real one.
 */
const releasePreviewQueueMessageSchema = z.object({
  version: z.literal(1),
  type: z.literal("release-preview"),
  storefrontId: z.string().uuid(),
  releaseId: z.string().uuid(),
});

export type ReleasePreviewQueueMessage = z.infer<
  typeof releasePreviewQueueMessageSchema
>;

const storefrontQueueMessageSchema = z.discriminatedUnion("type", [
  themeBuildQueueMessageSchema,
  releasePreviewQueueMessageSchema,
]);

export type StorefrontQueueMessage = z.infer<
  typeof storefrontQueueMessageSchema
>;

export type ThemeBuildQueue = {
  send(message: StorefrontQueueMessage): Promise<unknown>;
};

export function createReleasePreviewQueueMessage(input: {
  storefrontId: string;
  releaseId: string;
}): ReleasePreviewQueueMessage {
  return { version: 1, type: "release-preview", ...input };
}

/** Parses any message this queue carries, keeping the type discriminated. */
export function parseStorefrontQueueMessage(
  value: unknown,
): StorefrontQueueMessage {
  return storefrontQueueMessageSchema.parse(value);
}

export function createThemeBuildQueueMessage(input: {
  storefrontId: string;
  themeId: string;
  buildId: string;
}): ThemeBuildQueueMessage {
  return { version: 1, type: "theme-build", ...input };
}

export function parseThemeBuildQueueMessage(
  value: unknown,
): ThemeBuildQueueMessage {
  return themeBuildQueueMessageSchema.parse(value);
}
