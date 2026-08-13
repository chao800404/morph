import { z } from "zod";
import { idSchema } from "./commerce";

export const createPublishableApiKeyInputSchema = z.object({
  title: z.string().trim().min(1, "Title is required").max(200),
  salesChannelIds: z.array(idSchema("sales channel")).min(1).max(20),
});

export const revokePublishableApiKeyInputSchema = z.object({
  id: idSchema("API key"),
});
