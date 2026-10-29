import { describe, expect, it } from "vitest";
import { buildCsp } from "../../src/lib/csp";

const directive = (csp: string, name: string) => csp.split("; ").find((d) => d.startsWith(name + " "));

describe("buildCsp", () => {
  it("production: nonce-based scripts, no unsafe-inline / unsafe-eval", () => {
    const csp = buildCsp("abc123", false);
    expect(directive(csp, "script-src")).toBe("script-src 'self' 'nonce-abc123' 'strict-dynamic'");
    expect(csp).not.toContain("unsafe-inline");
    expect(csp).not.toContain("unsafe-eval");
    expect(csp).toContain("frame-ancestors 'none'");
    expect(csp).toContain("object-src 'none'");
    expect(csp).toContain("upgrade-insecure-requests");
  });
  it("development adds unsafe-eval only (needed by React dev tooling)", () => {
    const csp = buildCsp("abc123", true);
    expect(directive(csp, "script-src")).toContain("'unsafe-eval'");
    expect(csp).not.toContain("unsafe-inline");
    expect(csp).not.toContain("upgrade-insecure-requests");
  });
});
