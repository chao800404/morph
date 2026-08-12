import type { AssetActionResult } from "@/lib/asset/action-result";
import { updateDashboardUser } from "@/server/auth/dashboard-users.serverFn";
import {
  createDashboardInvite,
  deleteDashboardInvites,
} from "@/server/auth/invites.serverFn";

const text = (data: FormData, key: string) => {
  const value = data.get(key);
  return typeof value === "string" ? value.trim() : "";
};

export const updateDashboardUserAction = async (
  data: FormData,
): Promise<AssetActionResult> => {
  const result = await updateDashboardUser({
    data: {
      id: text(data, "id"),
      firstName: text(data, "firstName"),
      lastName: text(data, "lastName"),
    },
  });
  return {
    success: result.success,
    message: result.message,
    errors: result.success ? undefined : result.errors,
  };
};

export const createDashboardInviteAction = async (
  _state: unknown,
  data: FormData,
) => {
  const result = await createDashboardInvite({
    data: { email: text(data, "email") },
  });
  return {
    success: result.success,
    message: result.message,
    errors: result.success ? undefined : result.errors,
  };
};

export const deleteDashboardInvitesAction = async ({
  data,
}: {
  data: FormData;
}) => {
  const value = data.get("ids");
  let ids: string[] = [];
  try {
    const parsed = JSON.parse(typeof value === "string" ? value : "[]");
    ids = Array.isArray(parsed)
      ? parsed.filter((id) => typeof id === "string")
      : [];
  } catch {
    ids = [];
  }
  const result = await deleteDashboardInvites({ data: { ids } });
  return { success: result.success, message: result.message };
};
