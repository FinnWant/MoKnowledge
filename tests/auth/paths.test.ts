import { describe, expect, it } from "vitest";
import { isPublicPath, safeNextPath } from "@/lib/auth/paths";

describe("isPublicPath", () => {
  it("lets the marketing page and the login flow through", () => {
    expect(isPublicPath("/")).toBe(true);
    expect(isPublicPath("/login")).toBe(true);
    expect(isPublicPath("/auth/sign-out")).toBe(true);
  });

  it("protects everything that touches storage", () => {
    expect(isPublicPath("/knowledge")).toBe(false);
    expect(isPublicPath("/knowledge/view")).toBe(false);
    expect(isPublicPath("/knowledge/view/abc")).toBe(false);
    expect(isPublicPath("/api/knowledge-bases")).toBe(false);
    expect(isPublicPath("/api/scrape")).toBe(false);
  });

  it("does not treat a path that merely starts with a public one as public", () => {
    // The bug a naive `startsWith` produces: `/loginate` is not under `/login`,
    // and neither is `/authorised-only`.
    expect(isPublicPath("/loginate")).toBe(false);
    expect(isPublicPath("/authority")).toBe(false);
  });
});

describe("safeNextPath", () => {
  it("keeps a same-origin path", () => {
    expect(safeNextPath("/knowledge/view")).toBe("/knowledge/view");
    expect(safeNextPath("/knowledge?mode=table")).toBe("/knowledge?mode=table");
  });

  it("falls back when there is nothing to go back to", () => {
    expect(safeNextPath(null)).toBe("/knowledge");
    expect(safeNextPath(undefined)).toBe("/knowledge");
    expect(safeNextPath("")).toBe("/knowledge");
  });

  it("refuses to bounce the user off-site after they sign in", () => {
    // An open redirect on a login page is worth more to an attacker than on
    // any other page: the user has just been asked to trust the origin.
    expect(safeNextPath("https://evil.example")).toBe("/knowledge");
    expect(safeNextPath("http://evil.example")).toBe("/knowledge");
    // Protocol-relative: another origin, but it starts with "/" so the obvious
    // check waves it through.
    expect(safeNextPath("//evil.example")).toBe("/knowledge");
    expect(safeNextPath("/\\evil.example")).toBe("/knowledge");
  });
});
