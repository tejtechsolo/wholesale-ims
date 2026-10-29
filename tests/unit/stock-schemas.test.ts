import { describe, expect, it } from "vitest";
import { reorderLevelSchema, transferStockSchema } from "../../src/lib/domain";

const a = "3f1c2b8e-6c1a-4a8e-9d55-0b6c1f2a7e91";
const b = "7a2d4c1e-9b3f-4e6a-8c2d-1f0e9b8a7c65";

describe("transferStockSchema", () => {
  const base = { product_id: a, from_warehouse_id: a, to_warehouse_id: b, quantity: "10" };
  it("accepts a valid transfer and coerces quantity", () => {
    expect(transferStockSchema.parse(base).quantity).toBe(10);
  });
  it("rejects same source and destination with a field-level message", () => {
    const r = transferStockSchema.safeParse({ ...base, to_warehouse_id: a });
    expect(r.success).toBe(false);
    expect(r.error?.issues[0]).toMatchObject({ path: ["to_warehouse_id"], message: "Choose a different destination warehouse" });
  });
  it.each([0, -5, 1.5, "x"])("rejects quantity %s", (quantity) => {
    expect(transferStockSchema.safeParse({ ...base, quantity }).success).toBe(false);
  });
});

describe("reorderLevelSchema", () => {
  it("allows 0 (disables the alert) but not negatives or fractions", () => {
    const base = { product_id: a, warehouse_id: b };
    expect(reorderLevelSchema.parse({ ...base, level: "0" }).level).toBe(0);
    expect(reorderLevelSchema.safeParse({ ...base, level: -1 }).success).toBe(false);
    expect(reorderLevelSchema.safeParse({ ...base, level: 2.5 }).success).toBe(false);
  });
});
