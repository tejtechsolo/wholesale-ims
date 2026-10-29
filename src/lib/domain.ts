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
