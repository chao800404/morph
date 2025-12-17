import { getSession } from "@/server/auth/getSession";

/**
 * Validate user session and return user info
 * @returns Object with success status, message, and user data
 */
export async function validateSession() {
  const session = await getSession();

  if (!session?.user) {
    return {
      success: false,
      message: "Unauthorized",
      user: null,
    };
  }

  return {
    success: true,
    message: "Authorized",
    user: session.user,
  };
}
