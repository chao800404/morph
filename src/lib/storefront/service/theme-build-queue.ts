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

export type ThemeBuildQueue = {
  send(message: ThemeBuildQueueMessage): Promise<unknown>;
};

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
