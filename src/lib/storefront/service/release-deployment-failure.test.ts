import { describe, expect, it } from "vitest";
import {
  describeReleaseDeploymentFailure,
  releaseDeploymentFailureCode,
} from "./release-deployment-failure";

describe("releaseDeploymentFailureCode", () => {
  it("names the plan rule or deployer reason before the reconciler's", () => {
    expect(
      releaseDeploymentFailureCode({
        reason: "PLAN_REJECTED",
        detail: "MISSING_WORKER_ENTRY",
      }),
    ).toBe("MISSING_WORKER_ENTRY");
    expect(
      releaseDeploymentFailureCode({
        reason: "DEPLOY_FAILED",
        detail: "UPLOAD_REJECTED",
      }),
    ).toBe("UPLOAD_REJECTED");
    expect(
      releaseDeploymentFailureCode({ reason: "WORKER_CONFIG_UNREADABLE" }),
    ).toBe("WORKER_CONFIG_UNREADABLE");
  });

  it("falls back to DEPLOY_ERROR for a deployer that threw, or an unknown code", () => {
    expect(releaseDeploymentFailureCode({})).toBe("DEPLOY_ERROR");
    expect(releaseDeploymentFailureCode({ reason: "DEPLOY_FAILED" })).toBe(
      "DEPLOY_ERROR",
    );
    expect(releaseDeploymentFailureCode({ detail: "toString" })).toBe(
      "DEPLOY_ERROR",
    );
  });
});

describe("describeReleaseDeploymentFailure", () => {
  it("keeps the stable top-level code and adds the specific reason and a sentence", () => {
    const described = describeReleaseDeploymentFailure({
      reason: "PLAN_REJECTED",
      detail: "MISSING_CLIENT_ASSETS",
      deploymentDrift: false,
    });
    expect(described.error).toBe("RELEASE_DEPLOYMENT_FAILED");
    expect(described.reason).toBe("MISSING_CLIENT_ASSETS");
    expect(described.message).toContain("no client output");
    expect(described.message).toContain("(MISSING_CLIENT_ASSETS)");
    expect(described.message).toContain("previous activation was restored");
    // A retry cannot fix the build's shape.
    expect(described.message).toContain("change the Theme");
  });

  it("asks for a retry when the failure was the transport's", () => {
    const described = describeReleaseDeploymentFailure({
      reason: "DEPLOY_FAILED",
      detail: "DEPLOY_TIMEOUT",
    });
    expect(described.reason).toBe("DEPLOY_TIMEOUT");
    expect(described.message).toContain("retry publishing");
  });

  it("reports drift as its own code, still with the reason", () => {
    expect(
      describeReleaseDeploymentFailure({
        reason: "DEPLOY_FAILED",
        detail: "UPLOAD_REJECTED",
        deploymentDrift: true,
      }),
    ).toMatchObject({
      error: "RELEASE_DEPLOYMENT_DRIFT",
      reason: "UPLOAD_REJECTED",
      message: expect.stringContaining("requires reconciliation"),
    });
  });
});
