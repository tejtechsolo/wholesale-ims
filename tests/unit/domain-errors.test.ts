import { describe, expect, it } from "vitest";
import { checkLine, nextActions, placeOrderSchema, adjustStockSchema } from "../../src/lib/domain";
import { toAppError } from "../../src/lib/errors";

const uuid = "3f1c2b8e-6c1a-4a8e-9d55-0b6c1f2a7e91";

describe("placeOrderSchema", () => {
  const base = { customer_id: uuid, idempotency_key: uuid, items: [{ product_id: uuid, warehouse_id: uuid, quantity: "5" }] };
  it("coerces form-string quantities to integers", () => {
    expect(placeOrderSchema.parse(base).items[0].quantity).toBe(5);
  });
  it.each([0, -1, 2.5, "abc", 2_000_000])("rejects quantity %s", (quantity) => {
    expect(placeOrderSchema.safeParse({ ...base, items: [{ ...base.items[0], quantity }] }).success).toBe(false);
  });
  it("rejects empty carts, >100 lines and non-uuid ids", () => {
    expect(placeOrderSchema.safeParse({ ...base, items: [] }).success).toBe(false);
    expect(placeOrderSchema.safeParse({ ...base, items: Array(101).fill(base.items[0]) }).success).toBe(false);
    expect(placeOrderSchema.safeParse({ ...base, customer_id: "1 OR 1=1" }).success).toBe(false);
  });
});

describe("adjustStockSchema", () => {
  it("requires a non-zero delta and a reason", () => {
    const b = { product_id: uuid, warehouse_id: uuid };
    expect(adjustStockSchema.safeParse({ ...b, delta: 0, reason: "count" }).success).toBe(false);
    expect(adjustStockSchema.safeParse({ ...b, delta: -3, reason: "  " }).success).toBe(false);
    expect(adjustStockSchema.safeParse({ ...b, delta: -3, reason: "damaged" }).success).toBe(true);
  });
});

describe("checkLine (UI pre-check)", () => {
  const rice = { sku: "RICE-25KG", min_order_qty: 5, pack_size: 5, available: 20 };
  it("returns null for a valid line and a message otherwise", () => {
    expect(checkLine({ quantity: 10 }, rice)).toBeNull();
    expect(checkLine({ quantity: 3 }, rice)).toMatch(/minimum order is 5/);
    expect(checkLine({ quantity: 12 }, rice)).toMatch(/multiples of 5/);
    expect(checkLine({ quantity: 25 }, rice)).toMatch(/only 20 available/);
  });
});

describe("nextActions", () => {
  it("only offers buttons the role can use", () => {
    expect(nextActions("submitted", "customer")).toEqual(["cancelled"]);
    expect(nextActions("submitted", "manager")).toEqual(["approved", "cancelled"]);
    expect(nextActions("approved", "warehouse")).toEqual(["picking"]);
    expect(nextActions("delivered", "admin")).toEqual([]);
    expect(nextActions("cancelled", "admin")).toEqual([]);
  });
});

describe("toAppError", () => {
  it("maps a PostgREST business error with JSON details to a friendly message", () => {
    const e = toAppError({ code: "P0001", message: "INSUFFICIENT_STOCK",
      details: '{"sku":"OIL-15L","available":3,"requested":5}' });
    expect(e).toMatchObject({ code: "INSUFFICIENT_STOCK", status: 409 });
    expect(e.message).toBe("Not enough stock for OIL-15L: 3 available, 5 requested.");
  });
  it("maps node-postgres style errors (detail, not details)", () => {
    expect(toAppError({ code: "P0001", message: "CREDIT_LIMIT_EXCEEDED", detail: "{}" }).status).toBe(409);
  });
  it("maps permission, unique and check violations", () => {
    expect(toAppError({ code: "42501", message: "permission denied for table inventory" }))
      .toEqual({ code: "FORBIDDEN", status: 403, message: "You don't have permission to do that." });
    expect(toAppError({ code: "23505" }).code).toBe("CONFLICT");
    expect(toAppError({ code: "23514" }).code).toBe("VALIDATION");
  });
  it("never leaks unknown database messages", () => {
    const e = toAppError({ code: "XX000", message: 'relation "secret_table" does not exist' });
    expect(e).toEqual({ code: "INTERNAL", status: 500, message: "Something went wrong. Please try again." });
    expect(toAppError({ code: "P0001", message: "SOMETHING_NEW" }).code).toBe("INTERNAL");
    expect(toAppError(undefined).code).toBe("INTERNAL");
  });
  it("tolerates malformed details", () => {
    expect(toAppError({ code: "P0001", message: "INSUFFICIENT_STOCK", details: "not json" }).message)
      .toBe("Not enough stock for one of the items.");
  });
});
