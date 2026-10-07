import { describe, expect, it, vi } from "vitest";
import type { StorefrontBuildPreviewCapabilityDAL } from "../../dal/storefront-build-preview-capability.dal";
import { PREVIEW_EGRESS_HEADER } from "../preview-egress-policy";
import { hashBuildPreviewToken } from "./build-preview-capability";
import { answerBuildPreviewEgress } from "./build-preview-egress";

vi.mock("cloudflare:workers", () => ({ env: {} }));

const TOKEN = "0123456789abcdef0123456789abcdef01234567";
const OWN = `https://bp-${TOKEN}.preview.example.test`;

const lines: string[] = [];

function deps() {
  const getPublishedDocument = vi.fn(async () => ({
    sections: [{ id: "hero", enabled: true, props: { heading: "Frozen" } }],
  }));
  return {
    getPublishedDocument,
    deps: {
      env: { THEME_PREVIEW_HOSTNAME: "preview.example.test" },
      capabilityDal: {
        findByTokenHash: async (hash: string) =>
          hash !== (await hashBuildPreviewToken(TOKEN))
            ? null
            : {
                id: "cap-1",
                storefrontId: "sf-1",
                themeId: "th-1",
                buildId: "build-1",
                userId: "admin-1",
                expiresAt: "2026-10-07T01:00:00.000Z",
                revokedAt: null,
                build: {
                  storefrontId: "sf-1",
                  themeId: "th-1",
                  status: "succeeded",
                  artifactPrefix: "builds/1/",
                  contentPublicationId: "pub-1",
                },
                themeLive: true,
                user: { role: "admin", banned: false },
              },
      } as unknown as StorefrontBuildPreviewCapabilityDAL,
      contentPorts: { getPublishedDocument } as never,
      containerIdFor: (capabilityId: string) => `container-of-${capabilityId}`,
      now: new Date("2026-10-07T00:00:00.000Z"),
      log: (line: string) => lines.push(line),
    },
  };
}

const ask = (url: string, containerId = "container-of-cap-1") => {
  const { deps: d, getPublishedDocument } = deps();
  return {
    response: answerBuildPreviewEgress(new Request(url), containerId, d),
    getPublishedDocument,
  };
};

describe("a Build Preview container's outbound requests", () => {
  it("are answered for its own content, from the build's snapshot", async () => {
    const { response, getPublishedDocument } = ask(
      `${OWN}/_morph/content?path=/`,
    );
    const answered = await response;
    expect(answered.status).toBe(200);
    expect(await answered.json()).toEqual({
      slots: { hero: { heading: "Frozen" } },
      hiddenSlots: [],
    });
    expect(getPublishedDocument).toHaveBeenCalledWith(
      expect.objectContaining({ publicationId: "pub-1" }),
    );
  });

  it.each([
    ["anywhere else", "https://api.example.com/v1"],
    ["Core's own host", "https://preview.example.test/_morph/content?path=/"],
    ["another path on its own host", `${OWN}/account`],
    [
      "a token nobody issued",
      `https://bp-${"f".repeat(40)}.preview.example.test/_morph/content?path=/`,
    ],
  ])("are refused %s", async (_name, url) => {
    const { response, getPublishedDocument } = ask(url);
    const answered = await response;
    expect(answered.status).toBe(403);
    expect(answered.headers.get(PREVIEW_EGRESS_HEADER)).toBeTruthy();
    expect(getPublishedDocument).not.toHaveBeenCalled();
  });

  it("are refused for another preview's content, even with its address", async () => {
    const { response, getPublishedDocument } = ask(
      `${OWN}/_morph/content?path=/`,
      "container-of-someone-else",
    );
    const answered = await response;
    expect(answered.status).toBe(403);
    expect(await answered.text()).toContain("another preview's content");
    expect(getPublishedDocument).not.toHaveBeenCalled();
  });

  it("are each recorded with the decision and host, never the path or query", async () => {
    lines.length = 0;
    await (
      await ask(`${OWN}/_morph/content?path=/secret-page`).response
    ).text();
    await (await ask("https://api.example.com/leak?secret=1").response).text();
    expect(lines).toHaveLength(2);
    expect(lines[0]).toContain('"decision":"answered: own content"');
    expect(lines[1]).toContain(
      `"decision":"refused: not this preview's content"`,
    );
    expect(lines[1]).toContain('"destination":"https://api.example.com"');
    expect(lines.join("\n")).not.toMatch(/secret|leak|_morph/);
  });

  it("are recorded only so often per container", async () => {
    lines.length = 0;
    for (let i = 0; i < 30; i += 1) {
      await (
        await ask("https://api.example.com/", "noisy-container").response
      ).text();
    }
    expect(lines).toHaveLength(20);
  });

  it("never name the path or query of what they refused", async () => {
    const { response } = ask("https://api.example.com/leak?secret=1");
    const text = await (await response).text();
    expect(text).toContain("https://api.example.com");
    expect(text).not.toContain("secret");
    expect(text).not.toContain("/leak");
  });
});
