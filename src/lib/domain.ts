// Shared domain types + rules used by Server Actions and the UI.
// The database is the source of truth; these mirror it so the UI can
// validate early and only show actions the user is allowed to take.
import { z } from "zod";

export const ROLES = ["admin", "manager", "warehouse", "sales", "customer"] as const;
export type Role = (typeof ROLES)[number];

export const ORDER_STATUSES = [
  "submitted", "approved", "picking", "shipped", "delivered", "cancelled",
] as const;
export type OrderStatus = (typeof ORDER_STATUSES)[number];

// MUST stay identical to public.transition_allowed() — a DB test enforces parity.
const TRANSITIONS: Record<string, readonly Role[]> = {
  "submitted>approved": ["manager", "admin"],
  "submitted>cancelled": ["customer", "sales", "manager", "admin"],
  "approved>picking": ["warehouse", "manager", "admin"],
  "approved>cancelled": ["manager", "admin"],
  "picking>cancelled": ["manager", "admin"],
  "picking>shipped": ["warehouse", "manager", "admin"],
  "shipped>delivered": ["warehouse", "manager", "admin"],
};

export function canTransition(from: OrderStatus, to: OrderStatus, role: Role): boolean {
  return TRANSITIONS[`${from}>${to}`]?.includes(role) ?? false;
}

export function nextActions(from: OrderStatus, role: Role): OrderStatus[] {
  return ORDER_STATUSES.filter((to) => canTransition(from, to, role));
}

// ---- Input validation (first line of defence; DB re-validates everything) ----
export const orderLineSchema = z.object({
  product_id: z.uuid(),
  warehouse_id: z.uuid(),
  quantity: z.coerce.number().int().positive().max(1_000_000),
});

export const placeOrderSchema = z.object({
  customer_id: z.uuid(),
  idempotency_key: z.uuid(),
  notes: z.string().trim().max(1000).optional(),
  items: z.array(orderLineSchema).min(1, "Add at least one item").max(100),
});
export type PlaceOrderInput = z.infer<typeof placeOrderSchema>;

export const adjustStockSchema = z.object({
  product_id: z.uuid(),
  warehouse_id: z.uuid(),
  delta: z.coerce.number().int().refine((n) => n !== 0, "Delta cannot be zero"),
  reason: z.string().trim().min(3, "Reason is required").max(500),
});

export const receiveStockSchema = z.object({
  product_id: z.uuid(),
  warehouse_id: z.uuid(),
  quantity: z.coerce.number().int().positive().max(1_000_000),
  reason: z.string().trim().max(500).optional(),
});

/** Client-side pre-check against the catalog; the DB repeats this under a lock. */
export function checkLine(
  line: { quantity: number },
  product: { sku: string; min_order_qty: number; pack_size: number; available: number },
): string | null {
  if (line.quantity < product.min_order_qty)
    return `${product.sku}: minimum order is ${product.min_order_qty}`;
  if (line.quantity % product.pack_size !== 0)
    return `${product.sku}: order in multiples of ${product.pack_size}`;
  if (line.quantity > product.available)
    return `${product.sku}: only ${product.available} available`;
  return null;
}

export const transferStockSchema = z.object({
  product_id: z.uuid(),
  from_warehouse_id: z.uuid(),
  to_warehouse_id: z.uuid(),
  quantity: z.coerce.number().int().positive().max(1_000_000),
  reason: z.string().trim().max(500).optional(),
}).refine((v) => v.from_warehouse_id !== v.to_warehouse_id, {
  message: "Choose a different destination warehouse", path: ["to_warehouse_id"],
});

export const reorderLevelSchema = z.object({
  product_id: z.uuid(),
  warehouse_id: z.uuid(),
  level: z.coerce.number().int().min(0).max(1_000_000),
});

export const PAYMENT_METHODS = ["cash", "bank_transfer", "upi", "cheque"] as const;

export const recordPaymentSchema = z.object({
  customer_id: z.uuid(),
  idempotency_key: z.uuid(),
  method: z.enum(PAYMENT_METHODS),
  reference: z.string().trim().max(100).optional(),
  // Rupees with at most 2 decimals; kept as a string so no float rounding reaches the DB.
  amount: z.string().trim().regex(/^\d{1,12}(\.\d{1,2})?$/, "Enter an amount like 1500 or 1500.50")
    .refine((v) => Number(v) > 0, "Amount must be more than zero"),
});

// ---- Admin console ----
const money = z.coerce.number().positive().max(10_000_000).multipleOf(0.01);

export const productSchema = z.object({
  sku: z.string().trim().toUpperCase().regex(/^[A-Z0-9-]{3,40}$/, "SKU: 3-40 letters, digits or dashes"),
  name: z.string().trim().min(2).max(200),
  unit: z.string().trim().min(1).max(20),
  unit_price: money,
  min_order_qty: z.coerce.number().int().min(1).max(1_000_000),
  pack_size: z.coerce.number().int().min(1).max(1_000_000),
  active: z.boolean(),
});

export const customerSchema = z.object({
  name: z.string().trim().min(2).max(200),
  gstin: z.string().trim().toUpperCase().regex(/^[0-9]{2}[A-Z0-9]{13}$/, "GSTIN must be 15 characters")
    .optional().or(z.literal("").transform(() => undefined)),
  credit_limit: z.coerce.number().min(0).max(1_000_000_000).multipleOf(0.01),
  payment_terms_days: z.coerce.number().int().min(0).max(365),
  active: z.boolean(),
});

export const warehouseSchema = z.object({
  code: z.string().trim().toUpperCase().regex(/^[A-Z0-9-]{2,20}$/, "Code: 2-20 letters, digits or dashes"),
  name: z.string().trim().min(2).max(100),
});

export const userRoleSchema = z.object({
  user_id: z.uuid(),
  role: z.enum(ROLES),
  customer_id: z.uuid().optional().or(z.literal("").transform(() => undefined)),
}).refine((v) => v.role !== "customer" || !!v.customer_id, {
  message: "Pick the customer account for a buyer", path: ["customer_id"],
});
