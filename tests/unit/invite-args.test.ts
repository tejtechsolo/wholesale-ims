import { describe, expect, it } from "vitest";
import { parseInviteArgs } from "../../scripts/invite-args.mjs";

const env = { NEXT_PUBLIC_SUPABASE_URL: "https://x.supabase.co", SUPABASE_SECRET_KEY: "s", SITE_URL: "https://app.example" };
const local = { ...env, NEXT_PUBLIC_SUPABASE_URL: "http://127.0.0.1:54321" };
const cust = "10000000-0000-4000-8000-00000000000a";

describe("parseInviteArgs", () => {
  it("parses a staff invite and normalises the email", () => {
    expect(parseInviteArgs(["--email", " Asha@Shop.IN ", "--role", "manager", "--name", "Asha"], env))
      .toEqual({ email: "asha@shop.in", role: "manager", name: "Asha", customerId: null, password: null });
  });
  it("requires a customer uuid for buyers and forbids it for staff", () => {
    expect(() => parseInviteArgs(["--email", "b@c.de", "--role", "customer", "--name", "Bo"], env)).toThrow(/--customer/);
    expect(parseInviteArgs(["--email", "b@c.de", "--role", "customer", "--name", "Bo", "--customer", cust], env).customerId).toBe(cust);
    expect(() => parseInviteArgs(["--email", "b@c.de", "--role", "sales", "--name", "Bo", "--customer", cust], env)).toThrow(/only valid/);
  });
  it.each([
    [["--email", "nope", "--role", "sales", "--name", "Al"], /valid email/],
    [["--email", "a@b.co", "--role", "owner", "--name", "Al"], /--role/],
    [["--email", "a@b.co", "--role", "sales", "--name", "A"], /--name/],
    [["--email", "a@b.co", "--role", "sales", "--name", "Al", "--admin", "yes"], /unknown option/],
    [["--email", "a@b.co", "--role"], /missing value/],
  ])("rejects %j", (argv, msg) => {
    expect(() => parseInviteArgs(argv, env)).toThrow(msg);
  });
  it("only allows direct passwords against a local stack", () => {
    const argv = ["--email", "a@b.co", "--role", "sales", "--name", "Al", "--password", "Long-enough-1"];
    expect(() => parseInviteArgs(argv, env)).toThrow(/local Supabase/);
    expect(parseInviteArgs(argv, local).password).toBe("Long-enough-1");
  });
  it("requires the secret key and SITE_URL for email invites", () => {
    const argv = ["--email", "a@b.co", "--role", "sales", "--name", "Al"];
    expect(() => parseInviteArgs(argv, { ...env, SUPABASE_SECRET_KEY: "" })).toThrow(/SUPABASE_SECRET_KEY/);
    expect(() => parseInviteArgs(argv, { ...env, SITE_URL: undefined })).toThrow(/SITE_URL/);
  });
});
