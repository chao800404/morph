import { Buffer } from "node:buffer";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CloudflareAdapter } from "./cloudflare.adapter";

const config = {
  accountId: "a".repeat(32),
  apiToken: "fake-email-token-never-real",
  defaultFromAddress: "mail@example.com",
  defaultFromName: "Example Shop",
};
const message = {
  to: "buyer@example.com",
  subject: "Your code",
  html: "<p>123456</p>",
};
const accepted = (overrides = {}) => ({
  success: true,
  errors: [],
  result: {
    delivered: [message.to],
    queued: [],
    permanent_bounces: [],
    ...overrides,
  },
});

describe("Cloudflare Email Sending REST adapter (fake network only)", () => {
  const fakeFetch = vi.fn<typeof fetch>();
  let errorLog: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    fakeFetch.mockReset();
    vi.stubGlobal("fetch", fakeFetch);
    errorLog = vi.spyOn(console, "error").mockImplementation(() => {});
  });
  afterEach(() => vi.unstubAllGlobals());

  it("uses the configured sender identity and documented REST field names", async () => {
    fakeFetch.mockResolvedValue(
      Response.json(
        accepted({ queued: ["queued@example.com"], message_id: "message-1" }),
      ),
    );
    const result = await new CloudflareAdapter(config).send({
      ...message,
      to: [message.to, "Queued Buyer <queued@example.com>"],
      text: "123456",
      replyTo: "Help <help@example.com>",
      attachments: [
        {
          filename: "a.txt",
          content: Buffer.from("hello"),
          contentType: "text/plain",
        },
        { filename: "b.bin", content: "aGVsbG8=" },
      ],
    });
    expect(result).toEqual({ success: true, messageId: "message-1" });
    expect(fakeFetch).toHaveBeenCalledTimes(1);
    const [url, request] = fakeFetch.mock.calls[0];
    expect(url).toBe(
      `https://api.cloudflare.com/client/v4/accounts/${config.accountId}/email/sending/send`,
    );
    expect(request).toMatchObject({
      method: "POST",
      redirect: "error",
      headers: {
        Authorization: `Bearer ${config.apiToken}`,
        "Content-Type": "application/json",
      },
    });
    expect(request?.signal).toBeDefined();
    expect(JSON.parse(String(request?.body))).toEqual({
      from: { address: "mail@example.com", name: "Example Shop" },
      to: [
        { address: message.to },
        { address: "queued@example.com", name: "Queued Buyer" },
      ],
      subject: "Your code",
      html: message.html,
      text: "123456",
      reply_to: { address: "help@example.com", name: "Help" },
      attachments: [
        {
          filename: "a.txt",
          content: "aGVsbG8=",
          type: "text/plain",
          disposition: "attachment",
        },
        {
          filename: "b.bin",
          content: "aGVsbG8=",
          type: "application/octet-stream",
          disposition: "attachment",
        },
      ],
    });
  });

  it("accepts delivered and queued recipients and preserves an optional message id", async () => {
    fakeFetch.mockResolvedValue(
      Response.json(
        accepted({ queued: ["next@example.com"], message_id: "message-1" }),
      ),
    );
    await expect(
      new CloudflareAdapter(config).send({
        ...message,
        to: [message.to, "next@example.com"],
      }),
    ).resolves.toEqual({ success: true, messageId: "message-1" });
  });

  it("accepts the documented response without a message id, without inventing one", async () => {
    fakeFetch.mockResolvedValue(Response.json(accepted()));
    await expect(new CloudflareAdapter(config).send(message)).resolves.toEqual({
      success: true,
    });
    expect(errorLog).not.toHaveBeenCalled();
  });

  it("preserves a per-message sender override", async () => {
    fakeFetch.mockResolvedValue(Response.json(accepted()));
    await new CloudflareAdapter(config).send({
      ...message,
      from: "Other <other@example.com>",
    });
    expect(JSON.parse(String(fakeFetch.mock.calls[0][1]?.body)).from).toEqual({
      address: "other@example.com",
      name: "Other",
    });
  });

  it.each([400, 401, 403, 429, 500])(
    "maps HTTP %s to a safe failure, with no retry",
    async (status) => {
      fakeFetch.mockResolvedValue(
        new Response(`${message.to} 123456 ${config.apiToken}`, { status }),
      );
      await expect(
        new CloudflareAdapter(config).send(message),
      ).resolves.toEqual({
        success: false,
        error: "Cloudflare email failed: PROVIDER_REJECTED",
      });
      expect(fakeFetch).toHaveBeenCalledTimes(1);
      expect(errorLog).toHaveBeenCalledWith(
        "Cloudflare email failed:",
        "PROVIDER_REJECTED",
      );
    },
  );

  it.each([
    { success: false, errors: [{ message: "buyer@example.com 123456" }] },
    { ...accepted(), errors: [{ code: 10001, message: "secret" }] },
    { success: true, errors: [], result: {} },
    null,
  ])(
    "does not trust a successful HTTP status with an invalid envelope: %j",
    async (payload) => {
      fakeFetch.mockResolvedValue(Response.json(payload));
      await expect(
        new CloudflareAdapter(config).send(message),
      ).resolves.toEqual({
        success: false,
        error: "Cloudflare email failed: INVALID_RESPONSE",
      });
    },
  );

  it.each([
    { permanent_bounces: [message.to] },
    { suppressed_recipients: [message.to] },
    { delivered: [], queued: [] },
  ])(
    "rejects bounces, suppression and missing delivery outcomes: %j",
    async (result) => {
      fakeFetch.mockResolvedValue(Response.json(accepted(result)));
      await expect(
        new CloudflareAdapter(config).send(message),
      ).resolves.toEqual({
        success: false,
        error: "Cloudflare email failed: RECIPIENT_NOT_ACCEPTED",
      });
    },
  );

  it("does not report a partially accepted multi-recipient send as success", async () => {
    fakeFetch.mockResolvedValue(Response.json(accepted()));
    await expect(
      new CloudflareAdapter(config).send({
        ...message,
        to: [message.to, "missing@example.com"],
      }),
    ).resolves.toEqual({
      success: false,
      error: "Cloudflare email failed: RECIPIENT_NOT_ACCEPTED",
    });
  });

  it.each([
    { accountId: "" },
    { accountId: "../another-account" },
    { apiToken: "" },
    { apiToken: "   " },
    { apiToken: "token\r\nheader" },
  ])(
    "fails visibly before any network access for bad configuration: %j",
    async (bad) => {
      await expect(
        new CloudflareAdapter({ ...config, ...bad }).send(message),
      ).resolves.toEqual({
        success: false,
        error: "Cloudflare email failed: NOT_CONFIGURED",
      });
      expect(fakeFetch).not.toHaveBeenCalled();
      expect(errorLog).toHaveBeenCalled();
    },
  );

  // Object rows keep Vitest from spreading an address array into callback args.
  it.each([
    { to: [] },
    { to: Array.from({ length: 51 }, (_, i) => `buyer${i}@example.com`) },
  ])("bounds the recipients before sending", async ({ to }) => {
    await expect(
      new CloudflareAdapter(config).send({ ...message, to }),
    ).resolves.toEqual({
      success: false,
      error: "Cloudflare email failed: RECIPIENT_LIMIT",
    });
    expect(fakeFetch).not.toHaveBeenCalled();
  });

  it("refuses malformed sender data", async () => {
    await expect(
      new CloudflareAdapter({
        ...config,
        defaultFromAddress: "not an email",
      }).send(message),
    ).resolves.toEqual({
      success: false,
      error: "Cloudflare email failed: INVALID_MESSAGE",
    });
    expect(fakeFetch).not.toHaveBeenCalled();
  });

  it("bounds the encoded request before sending", async () => {
    await expect(
      new CloudflareAdapter(config).send({
        ...message,
        html: "a".repeat(5 * 1024 * 1024),
      }),
    ).resolves.toEqual({
      success: false,
      error: "Cloudflare email failed: MESSAGE_TOO_LARGE",
    });
    expect(fakeFetch).not.toHaveBeenCalled();
  });

  it("never logs or returns upstream exception text and never retries an unknown outcome", async () => {
    fakeFetch.mockRejectedValue(
      new Error(`${message.to} 123456 ${config.apiToken}`),
    );
    const result = await new CloudflareAdapter(config).send(message);
    expect(result).toEqual({
      success: false,
      error: "Cloudflare email failed: REQUEST_FAILED",
    });
    expect(fakeFetch).toHaveBeenCalledTimes(1);
    const diagnostic = JSON.stringify({ result, logs: errorLog.mock.calls });
    for (const sensitive of [message.to, "123456", config.apiToken])
      expect(diagnostic).not.toContain(sensitive);
  });

  it("fails safely for malformed JSON and timeout errors", async () => {
    fakeFetch.mockResolvedValueOnce(new Response("not JSON"));
    fakeFetch.mockRejectedValueOnce(
      new DOMException("Timeout", "TimeoutError"),
    );
    const adapter = new CloudflareAdapter(config);
    expect((await adapter.send(message)).success).toBe(false);
    expect((await adapter.send(message)).success).toBe(false);
    expect(fakeFetch).toHaveBeenCalledTimes(2);
  });

  it("returns one result per batch entry without retrying failed sends", async () => {
    fakeFetch
      .mockResolvedValueOnce(Response.json(accepted()))
      .mockResolvedValueOnce(new Response("no", { status: 403 }));
    await expect(
      new CloudflareAdapter(config).sendBatch([message, message]),
    ).resolves.toEqual([
      { success: true },
      { success: false, error: "Cloudflare email failed: PROVIDER_REJECTED" },
    ]);
    expect(fakeFetch).toHaveBeenCalledTimes(2);
  });
});
