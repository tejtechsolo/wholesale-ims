import { describe, expect, it } from "vitest";
import { clientIp, throttleKeys } from "../../src/lib/throttle";

const h = (o: Record<string, string>) => ({ get: (k: string) => o[k] ?? null });

describe("clientIp", () => {
  it("takes the first X-Forwarded-For hop, then X-Real-IP, then 'unknown'", () => {
    expect(clientIp(h({ "x-forwarded-for": " 203.0.113.7 , 10.0.0.1" }))).toBe("203.0.113.7");
    expect(clientIp(h({ "x-real-ip": "198.51.100.2" }))).toBe("198.51.100.2");
    expect(clientIp(h({}))).toBe("unknown");
  });
});

describe("throttleKeys", () => {
  it("is deterministic, case-insensitive on email and 64-hex", () => {
    const a = throttleKeys("Asha@Shop.IN ", "1.2.3.4", "pepper");
    expect(a).toEqual(throttleKeys("asha@shop.in", "1.2.3.4", "pepper"));
    expect(a.pair).toMatch(/^[0-9a-f]{64}$/);
    expect(a.pair).not.toBe(a.ip);
  });
  it("differs per pepper, IP and email (keys can't be computed without the pepper)", () => {
    const base = throttleKeys("a@b.co", "1.2.3.4", "pepper");
    expect(throttleKeys("a@b.co", "1.2.3.4", "other").pair).not.toBe(base.pair);
    expect(throttleKeys("a@b.co", "1.2.3.5", "pepper").ip).not.toBe(base.ip);
    expect(throttleKeys("c@b.co", "1.2.3.4", "pepper").ip).toBe(base.ip); // same IP key
  });
});
