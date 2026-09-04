import { fail, failure, ok, paginationOf, parseInput } from "@/lib/db/server-result";
import { sendUserInviteEmail } from "@/lib/email";
import { inviteDal } from "@/lib/invite/dal/invite.dal";
import { createInviteToken, hashInviteToken } from "@/lib/invite/token";
import { dashboardUserDal } from "@/lib/user/dal/dashboard-user.dal";
import {
  acceptInviteInputSchema,
  createInviteInputSchema,
  deleteDashboardInviteInputSchema,
  getInviteInputSchema,
  listDashboardInvitesInputSchema,
} from "@/lib/validations/invite";
import { createServerFn } from "@tanstack/react-start";
import { userAdminMiddleware } from "../middleware/auth.middleware";
import { getAuthWithAdmin } from "./helpers";

const inviteState = async (token: string) => {
  const tokenHash = await hashInviteToken(token);
  const invite = await inviteDal.findActiveByTokenHash(tokenHash);
  if (!invite || invite.accepted || new Date(invite.expiresAt) <= new Date()) {
    return null;
  }
  return invite;
};

export const listDashboardInvites = createServerFn({ method: "POST" })
  .validator((data: unknown) => parseInput(listDashboardInvitesInputSchema, data ?? {}))
  .middleware([userAdminMiddleware])
  .handler(async ({ data: input }) => {
    // A rejected precondition is a client error the caller already
    // renders. Letting the ZodError escape the validator instead would
    // reach the browser as an opaque 500 with the reason stripped.
    if (!input.success) return input;
    const data = input.data;

    try {
      const page = await inviteDal.listPage({
        ...data,
        query: data.query ?? undefined,
      });
      return ok("Invitations fetched", {
        invites: page.invites.map(
          ({ tokenHash: _tokenHash, ...invite }) => invite,
        ),
        pagination: paginationOf(page.total, data.page, data.limit),
      });
    } catch (error) {
      return failure(
        "List dashboard invites error",
        error,
        "LIST_FAILED",
        "Failed to load invitations",
      );
    }
  });

export const deleteDashboardInvites = createServerFn({ method: "POST" })
  .validator((data: unknown) => parseInput(deleteDashboardInviteInputSchema, data))
  .middleware([userAdminMiddleware])
  .handler(async ({ data: input }) => {
    // A rejected precondition is a client error the caller already
    // renders. Letting the ZodError escape the validator instead would
    // reach the browser as an opaque 500 with the reason stripped.
    if (!input.success) return input;
    const data = input.data;

    try {
      await inviteDal.softDelete(data.ids);
      return ok(
        data.ids.length === 1 ? "Invitation deleted" : "Invitations deleted",
        { count: data.ids.length },
      );
    } catch (error) {
      return failure(
        "Delete dashboard invites error",
        error,
        "DELETE_FAILED",
        "Failed to delete invitation",
      );
    }
  });

export const createDashboardInvite = createServerFn({ method: "POST" })
  .validator((data: unknown) => parseInput(createInviteInputSchema, data))
  .middleware([userAdminMiddleware])
  .handler(async ({ data: input }) => {
    // A rejected precondition is a client error the caller already
    // renders. Letting the ZodError escape the validator instead would
    // reach the browser as an opaque 500 with the reason stripped.
    if (!input.success) return input;
    const data = input.data;

    try {
      if (await dashboardUserDal.existsByEmail(data.email)) {
        return fail("A user with this email already exists", {
          errors: { email: ["This email already belongs to a user"] },
        });
      }

      const token = createInviteToken();
      const tokenHash = await hashInviteToken(token);
      const expiresAt = new Date(
        Date.now() + 7 * 24 * 60 * 60 * 1000,
      ).toISOString();
      await inviteDal.replaceActive({
        id: crypto.randomUUID(),
        email: data.email,
        tokenHash,
        expiresAt,
      });

      const baseUrl = (
        process.env.PUBLIC_URL || "http://localhost:3000"
      ).replace(/\/$/, "");
      const delivery = await sendUserInviteEmail({
        email: data.email,
        inviteUrl: `${baseUrl}/invite?token=${encodeURIComponent(token)}`,
      });
      if (!delivery.success) {
        return fail(delivery.error ?? "Invitation email could not be sent");
      }
      return ok(`Invitation sent to ${data.email}`, { email: data.email });
    } catch (error) {
      return failure(
        "Create dashboard invite error",
        error,
        "CREATE_FAILED",
        "Failed to send invitation",
      );
    }
  });

export const getDashboardInvite = createServerFn({ method: "POST" })
  .validator((data: unknown) => parseInput(getInviteInputSchema, data))
  .handler(async ({ data: input }) => {
    // A rejected precondition is a client error the caller already
    // renders. Letting the ZodError escape the validator instead would
    // reach the browser as an opaque 500 with the reason stripped.
    if (!input.success) return input;
    const data = input.data;

    try {
      const invite = await inviteState(data.token);
      if (!invite) return fail("This invitation is invalid or has expired");
      return ok("Invitation found", { email: invite.email });
    } catch (error) {
      return failure(
        "Get dashboard invite error",
        error,
        "GET_FAILED",
        "Failed to load invitation",
      );
    }
  });

export const acceptDashboardInvite = createServerFn({ method: "POST" })
  .validator((data: unknown) => parseInput(acceptInviteInputSchema, data))
  .handler(async ({ data: input }) => {
    // A rejected precondition is a client error the caller already
    // renders. Letting the ZodError escape the validator instead would
    // reach the browser as an opaque 500 with the reason stripped.
    if (!input.success) return input;
    const data = input.data;

    try {
      const invite = await inviteState(data.token);
      if (!invite) return fail("This invitation is invalid or has expired");
      if (await dashboardUserDal.existsByEmail(invite.email)) {
        return fail("A user with this email already exists");
      }

      const created = await getAuthWithAdmin().api.createUser({
        body: {
          email: invite.email,
          password: data.password,
          name: data.name,
          role: "user",
        },
      });
      if (!created?.user) return fail("Failed to create user account");
      await inviteDal.markAccepted(invite.id);
      return ok("Your account is ready", { email: invite.email });
    } catch (error) {
      return failure(
        "Accept dashboard invite error",
        error,
        "ACCEPT_FAILED",
        "Failed to accept invitation",
      );
    }
  });
