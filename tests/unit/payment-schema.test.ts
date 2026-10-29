import { describe, expect, it } from "vitest";
import { recordPaymentSchema } from "../../src/lib/domain";

const id = "3f1c2b8e-6c1a-4a8e-9d55-0b6c1f2a7e91";
const base = { customer_id: id, idempotency_key: id, method: "upi" };

describe("recordPaymentSchema", () => {
  it.each(["1500", "1500.5", "1500.50", " 42 "])("accepts %j and keeps it a string", (amount) => {
    const r = recordPaymentSchema.parse({ ...base, amount });
    expect(typeof r.amount).toBe("string");
  });
  it.each(["0", "0.00", "-5", "1.005", "1e3", "abc", "", "12,000"])("rejects %j", (amount) => {
    expect(recordPaymentSchema.safeParse({ ...base, amount }).success).toBe(false);
  });
  it("rejects unknown methods", () => {
    expect(recordPaymentSchema.safeParse({ ...base, amount: "10", method: "crypto" }).success).toBe(false);
  });
});
