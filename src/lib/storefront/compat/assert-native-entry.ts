import { expect } from "vitest";

type RequestFixture = (path: string, init?: RequestInit) => Promise<Response>;

export async function assertCustomServerEntry(request: RequestFixture) {
  const response = await request("/compat-advanced");
  expect(response.status).toBe(200);
  expect(response.headers.get("x-compat-server-entry")).toBe("theme");
  expect(response.headers.get("x-compat-renderer")).toBe("custom-stream");
  expect(await response.text()).toContain("true:amount:1234");
  const api = await request("/api/compat");
  expect(api.status).toBe(200);
  expect(api.headers.get("x-compat-server-entry")).toBe("theme");
}

export async function assertSelectiveRendering(request: RequestFixture) {
  const off = await request("/compat-ssr-off");
  expect(off.status).toBe(200);
  expect(off.headers.get("x-compat-off-loader")).toBeNull();
  const offHtml = await off.text();
  expect(offHtml).toContain('data-selective="off-pending"');
  expect(offHtml).not.toContain('data-selective="off"');
  expect(offHtml).not.toContain("off-loader-ran");

  const data = await request("/compat-ssr-data");
  expect(data.status).toBe(200);
  expect(data.headers.get("x-compat-data-loader")).toBe("ran");
  const dataHtml = await data.text();
  expect(dataHtml).toContain('data-selective="data-pending"');
  expect(dataHtml).not.toContain('data-selective="data"');
  expect(dataHtml).not.toContain("server-component-ran");
  expect(dataHtml).toContain("data-loader-ran");
}
