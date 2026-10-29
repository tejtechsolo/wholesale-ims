import { describe, expect, it } from "vitest";
import { customerSchema, productSchema, userRoleSchema, warehouseSchema } from "../../src/lib/domain";

const uuid = "3f1c2b8e-6c1a-4a8e-9d55-0b6c1f2a7e91";

describe("productSchema", () => {
  const ok = { sku: " rice-25kg ", name: "Basmati 25kg", unit: "bag", unit_price: "1200.50", min_order_qty: "5", pack_size: "5", active: true };
  it("normalises SKU to upper case and coerces numbers", () => {
    expect(productSchema.parse(ok)).toMatchObject({ sku: "RICE-25KG", unit_price: 1200.5, min_order_qty: 5 });
  });
  it.each([
    ["sku", "a b"], ["unit_price", "0"], ["unit_price", "1.005"], ["min_order_qty", "0"], ["pack_size", "2.5"],
  ])("rejects %s=%j", (k, v) => {
    expect(productSchema.safeParse({ ...ok, [k]: v }).success).toBe(false);
  });
  it("does not turn the string 'false' into true for active", () => {
    expect(productSchema.safeParse({ ...ok, active: "false" }).success).toBe(false);
  });
});

describe("customerSchema", () => {
  const ok = { name: "Kota Traders", gstin: "08kotax1234a1z9", credit_limit: "25000", payment_terms_days: "30", active: true };
  it("upper-cases GSTIN and treats empty GSTIN as none", () => {
    expect(customerSchema.parse(ok).gstin).toBe("08KOTAX1234A1Z9");
    expect(customerSchema.parse({ ...ok, gstin: "" }).gstin).toBeUndefined();
  });
  it.each([["gstin", "12345"], ["credit_limit", "-1"], ["payment_terms_days", "400"], ["name", "K"]])(
    "rejects %s=%j", (k, v) => {
      expect(customerSchema.safeParse({ ...ok, [k]: v }).success).toBe(false);
    });
});

describe("warehouseSchema / userRoleSchema", () => {
  it("warehouse code is normalised and validated", () => {
    expect(warehouseSchema.parse({ code: "jai-02", name: "Jaipur 2" }).code).toBe("JAI-02");
    expect(warehouseSchema.safeParse({ code: "J", name: "Jaipur 2" }).success).toBe(false);
  });
  it("customer role needs a customer account; staff roles don't", () => {
    expect(userRoleSchema.safeParse({ user_id: uuid, role: "customer", customer_id: "" }).success).toBe(false);
    expect(userRoleSchema.safeParse({ user_id: uuid, role: "customer", customer_id: uuid }).success).toBe(true);
    expect(userRoleSchema.parse({ user_id: uuid, role: "sales", customer_id: "" }).customer_id).toBeUndefined();
    expect(userRoleSchema.safeParse({ user_id: uuid, role: "owner" }).success).toBe(false);
  });
});
