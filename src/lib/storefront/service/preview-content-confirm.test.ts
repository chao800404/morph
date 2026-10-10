import { describe, expect, it } from "vitest";
import type {
  PreviewContentRequest,
  PreviewContentResult,
} from "@/lib/storefront/compiler/preview-write-fence-sandbox";
import {
  confirmContainerPreviewContent,
  confirmPreviewContent,
  readPreviewContentProbe,
  writeContainerPreviewContent,
  type PreviewContentProbe,
} from "./preview-content-confirm";

// docs/astro-theme-plan.md A6c: a container preview's content write and its
// confirmation through the Worker, with the container and the probe faked.

function deps(options: {
  run?: PreviewContentResult;
  probes: PreviewContentProbe[];
}) {
  const requests: PreviewContentRequest[] = [];
  let clock = 0;
  let probeIndex = 0;
  return {
    requests,
    probesAsked: () => probeIndex,
    value: {
      run: async (request: PreviewContentRequest) => {
        requests.push(request);
        return options.run ?? { outcome: "written" as const, ticket: 5, instance: "server-a" };
      },
      probe: async () =>
        options.probes[Math.min(probeIndex++, options.probes.length - 1)] ?? null,
      sleep: async (ms: number) => {
        clock += ms;
      },
      now: () => clock,
    },
  };
}

describe("confirming a content snapshot through the Worker", () => {
  it("is applied once the Worker of that server names the ticket", async () => {
    const fake = deps({
      probes: [
        { ticket: 4, instance: "server-a" },
        { ticket: 5, instance: "server-a" },
      ],
    });
    expect(
      await confirmPreviewContent(fake.value, { ticket: 5, instance: "server-a" }),
    ).toEqual({ applied: true, ticket: 5 });
    expect(fake.probesAsked()).toBe(2);
  });

  it("is never confirmed by another server's Worker, whatever ticket it names", async () => {
    const fake = deps({ probes: [{ ticket: 9, instance: "server-before-restart" }] });
    expect(
      await confirmPreviewContent(
        fake.value,
        { ticket: 5, instance: "server-a" },
        1_000,
      ),
    ).toEqual({ applied: false, reason: "PREVIEW_CONTENT_NOT_CONFIRMED", ticket: 0 });
  });

  it("is not confirmed while the Worker does not answer", async () => {
    const fake = deps({ probes: [null] });
    expect(
      await confirmPreviewContent(fake.value, { ticket: 5, instance: "server-a" }, 500),
    ).toMatchObject({ applied: false, reason: "PREVIEW_CONTENT_NOT_CONFIRMED" });
  });

  it("reads the probe's headers, and nothing that is not a ticket", () => {
    expect(
      readPreviewContentProbe(
        new Headers({ "x-morph-content-ticket": "7", "x-morph-preview-instance": "s" }),
      ),
    ).toEqual({ ticket: 7, instance: "s" });
    expect(
      readPreviewContentProbe(new Headers({ "x-morph-content-ticket": "x" })),
    ).toBeNull();
  });
});

describe("writing a content snapshot into a container", () => {
  it("writes it under the fence, then confirms it with the instance the container named", async () => {
    const fake = deps({ probes: [{ ticket: 5, instance: "server-a" }] });
    expect(
      await writeContainerPreviewContent(fake.value, {
        content: "{}",
        instancePath: "/tmp/instance",
      }),
    ).toEqual({ applied: true, ticket: 5 });
    expect(fake.requests).toEqual([
      expect.objectContaining({ op: "content", instancePath: "/tmp/instance" }),
    ]);
  });

  it("confirms a resend of the same snapshot again", async () => {
    const fake = deps({
      run: { outcome: "same", ticket: 5, instance: "server-a" },
      probes: [{ ticket: 5, instance: "server-a" }],
    });
    expect(
      await writeContainerPreviewContent(fake.value, { content: "{}", instancePath: "/i" }),
    ).toEqual({ applied: true, ticket: 5 });
  });

  it("reports a refusal as one, and asks the Worker nothing", async () => {
    for (const [outcome, reason] of [
      ["superseded", "PREVIEW_CONTENT_SUPERSEDED"],
      ["conflict", "PREVIEW_CONTENT_TICKET_CONFLICT"],
      ["no-server", "PREVIEW_CONTENT_UNCONFIRMABLE"],
    ] as const) {
      const fake = deps({
        run: { outcome, ticket: 6, instance: outcome === "no-server" ? null : "s" },
        probes: [{ ticket: 9, instance: "s" }],
      });
      expect(
        await writeContainerPreviewContent(fake.value, { content: "{}", instancePath: "/i" }),
      ).toEqual({ applied: false, reason, ticket: 6 });
      expect(fake.probesAsked()).toBe(0);
    }
  });
});

describe("confirming a lost answer without writing", () => {
  it("asks the container which server runs, then that server's Worker", async () => {
    const fake = deps({
      run: { outcome: "read", ticket: 5, instance: "server-a" },
      probes: [{ ticket: 5, instance: "server-a" }],
    });
    expect(
      await confirmContainerPreviewContent(fake.value, { ticket: 5, instancePath: "/i" }),
    ).toEqual({ applied: true, ticket: 5 });
    expect(fake.requests).toEqual([expect.objectContaining({ op: "read" })]);
  });

  it("cannot confirm when no server has been stamped since the container started", async () => {
    const fake = deps({
      run: { outcome: "read", ticket: 0, instance: null },
      probes: [{ ticket: 5, instance: "anything" }],
    });
    expect(
      await confirmContainerPreviewContent(fake.value, { ticket: 5, instancePath: "/i" }),
    ).toEqual({ applied: false, reason: "PREVIEW_CONTENT_UNCONFIRMABLE", ticket: 0 });
  });
});
