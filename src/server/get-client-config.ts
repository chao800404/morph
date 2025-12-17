import { getConfig } from "@/cms.config";
import { createServerFn } from "@tanstack/react-start";

// This function guarantees execution ONLY on the server
export const getClientConfig = createServerFn({ method: "GET" }).handler(
  async () => {
    const config = getConfig();
    return config.client;
  },
);
