import { beforeEach, describe, expect, it, vi } from "vitest";
import { getConfig } from "@/server/get-config";
import { sendAuthVerificationEmail, sendPasswordResetEmail } from "./index";

vi.mock("@/server/get-config", () => ({
  getConfig: vi.fn(),
}));

describe("authentication email delivery", () => {
  const send = vi.fn();

  beforeEach(() => {
    send.mockReset();
    vi.mocked(getConfig).mockReturnValue({
      server: {
        appName: "Morph",
        email: { send },
      },
    } as never);
  });

  it("sends sign-in OTP through the configured adapter", async () => {
    send.mockResolvedValue({ success: true, messageId: "message-1" });

    await expect(
      sendAuthVerificationEmail({
        email: "member@example.com",
        otp: "123456",
        type: "sign-in",
      }),
    ).resolves.toMatchObject({ success: true });

    expect(send).toHaveBeenCalledWith(
      expect.objectContaining({
        to: "member@example.com",
        subject: "Your sign-in code for Morph",
        html: expect.stringContaining("123456"),
      }),
    );
  });

  it("sends email-verification OTP with a verification subject", async () => {
    send.mockResolvedValue({ success: true });

    await sendAuthVerificationEmail({
      email: "member@example.com",
      otp: "654321",
      type: "email-verification",
    });

    expect(send).toHaveBeenCalledWith(
      expect.objectContaining({
        subject: "Verify your email for Morph",
        html: expect.stringContaining("654321"),
      }),
    );
  });

  it("fails closed without exposing recipient or OTP when the adapter fails", async () => {
    send.mockResolvedValue({
      success: false,
      error: "provider rejected request",
    });

    const error = await sendAuthVerificationEmail({
      email: "member@example.com",
      otp: "123456",
      type: "sign-in",
    }).catch((value: unknown) => value);

    expect(error).toBeInstanceOf(Error);
    expect((error as Error).message).toBe(
      "Authentication email could not be sent.",
    );
    expect((error as Error).message).not.toContain("member@example.com");
    expect((error as Error).message).not.toContain("123456");
  });

  it("keeps password reset delivery fail-closed", async () => {
    send.mockResolvedValue({ success: false, error: "provider unavailable" });

    await expect(
      sendPasswordResetEmail({
        email: "member@example.com",
        otp: "123456",
      }),
    ).rejects.toThrow("Password reset email could not be sent.");
  });
});
