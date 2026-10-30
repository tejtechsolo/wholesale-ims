import { describe, expect, it } from "vitest";
import { classifySignInError, readSupabaseEnv } from "../../src/lib/env";

describe("readSupabaseEnv", () => {
  const ok = { NEXT_PUBLIC_SUPABASE_URL: "https://abcd.supabase.co/", NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: "sb_publishable_real123" };
  it("accepts a real project and trims the trailing slash", () => {
    expect(readSupabaseEnv(ok)).toEqual({ url: "https://abcd.supabase.co", key: "sb_publishable_real123" });
  });
  it.each([
    ["missing url", { ...ok, NEXT_PUBLIC_SUPABASE_URL: undefined }],
    ["missing key", { ...ok, NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: "" }],
    [".env.example url", { ...ok, NEXT_PUBLIC_SUPABASE_URL: "https://YOUR-PROJECT.supabase.co" }],
    [".env.example key", { ...ok, NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: "sb_publishable_xxx" }],
    ["CI dummy url", { ...ok, NEXT_PUBLIC_SUPABASE_URL: "https://example.supabase.co" }],
    ["not a url", { ...ok, NEXT_PUBLIC_SUPABASE_URL: "abcd.supabase.co" }],
    ["plain http to a remote host", { ...ok, NEXT_PUBLIC_SUPABASE_URL: "http://abcd.supabase.co" }],
  ])("rejects %s", (_n, env) => {
    expect(readSupabaseEnv(env)).toBeNull();
  });
  it("allows a local stack over http", () => {
    expect(readSupabaseEnv({ ...ok, NEXT_PUBLIC_SUPABASE_URL: "http://127.0.0.1:54321" })?.url).toBe("http://127.0.0.1:54321");
  });
});

describe("classifySignInError", () => {
  it("only real credential errors count as a wrong password", () => {
    expect(classifySignInError({ code: "invalid_credentials", status: 400 })).toBe("invalid_credentials");
    expect(classifySignInError({ status: 400 })).toBe("invalid_credentials");
  });
  it("network / server failures are 'unavailable', not a wrong password", () => {
    expect(classifySignInError({ name: "AuthRetryableFetchError", status: 0 })).toBe("unavailable");
    expect(classifySignInError({ status: 503, code: "unexpected_failure" })).toBe("unavailable");
  });
  it("other auth errors stay distinct; no error is null", () => {
    expect(classifySignInError({ code: "email_provider_disabled", status: 422 })).toBe("other");
    expect(classifySignInError(null)).toBeNull();
  });
});
