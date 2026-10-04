import { expect } from "vitest";

export async function assertNativeRoutes(
  request: (path: string, init?: RequestInit) => Promise<Response>,
) {
  const get = await request("/api/compat-items/item-42?q=hello%20world");
  expect(get.status).toBe(200);
  expect(get.headers.get("x-compat-request-mw")).toBe("1");
  expect(get.headers.get("x-compat-handler")).toBe("executed");
  expect(await get.json()).toEqual({
    id: "item-42",
    route: "route",
    handler: "route:get",
    query: "hello world",
  });
  const post = await request("/api/compat-items/item-43", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ title: "中文" }),
  });
  expect(post.status).toBe(200);
  expect(await post.json()).toEqual({
    id: "item-43",
    route: "route",
    body: { title: "中文" },
  });
  const denied = await request("/api/compat-items/item-42", {
    headers: { "x-compat-deny": "1" },
  });
  expect(denied.status).toBe(403);
  expect(denied.headers.get("x-compat-handler")).toBeNull();
  expect(await denied.text()).toBe("fixture-refused");
  const unsupported = await request("/api/compat-items/item-42", {
    method: "DELETE",
  });
  expect(unsupported.status).toBe(405);
  expect(await unsupported.text()).toBe("method-not-allowed");
  const head = await request("/api/compat-items/item-42", { method: "HEAD" });
  expect(head.status).toBe(200);
  expect(head.headers.get("x-compat-handler")).toBe("executed");
  expect(await head.text()).toBe("");
  const splat = await request("/api/compat-files/images/icons/logo.svg");
  expect(splat.status).toBe(200);
  expect(await splat.json()).toEqual({ path: "images/icons/logo.svg" });
}
