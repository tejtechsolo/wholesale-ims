// Maps database / Supabase errors to a stable, safe shape for the UI.
// Never forward raw Postgres messages to the browser: they can leak schema details.

export type AppErrorCode =
  | "UNAUTHENTICATED" | "FORBIDDEN" | "VALIDATION" | "INSUFFICIENT_STOCK"
  | "BELOW_MIN_ORDER_QTY" | "NOT_PACK_MULTIPLE" | "PRODUCT_INACTIVE" | "PRODUCT_NOT_FOUND"
  | "CUSTOMER_INACTIVE" | "ORDER_NOT_FOUND" | "INVALID_TRANSITION" | "CREDIT_LIMIT_EXCEEDED"
  | "INVENTORY_NOT_FOUND" | "ADJUST_BELOW_RESERVED" | "CUSTOMER_NOT_FOUND" | "PAYMENT_EXCEEDS_DUE" | "USER_NOT_FOUND" | "MFA_REQUIRED"
  | "CONFLICT" | "INTERNAL";

export interface AppError {
  code: AppErrorCode;
  message: string;      // safe to show to the user
  status: number;       // HTTP-ish status for route handlers / logging
  details?: Record<string, unknown>;
}

export type Result<T> = { ok: true; data: T } | { ok: false; error: AppError };

const KNOWN: Record<Exclude<AppErrorCode, "INTERNAL">, { status: number; msg: (d: any) => string }> = {
  UNAUTHENTICATED: { status: 401, msg: () => "Please sign in again." },
  FORBIDDEN: { status: 403, msg: () => "You don't have permission to do that." },
  VALIDATION: { status: 422, msg: (d) => `Invalid input${d?.field ? `: ${d.field}` : ""}.` },
  INSUFFICIENT_STOCK: {
    status: 409,
    msg: (d) => d?.sku
      ? `Not enough stock for ${d.sku}: ${d.available} available, ${d.requested} requested.`
      : "Not enough stock for one of the items.",
  },
  BELOW_MIN_ORDER_QTY: { status: 422, msg: (d) => `${d?.sku}: minimum order quantity is ${d?.min}.` },
  NOT_PACK_MULTIPLE: { status: 422, msg: (d) => `${d?.sku}: order in multiples of ${d?.pack_size}.` },
  PRODUCT_INACTIVE: { status: 409, msg: (d) => `${d?.sku ?? "A product"} is no longer available.` },
  PRODUCT_NOT_FOUND: { status: 404, msg: () => "One of the products no longer exists." },
  CUSTOMER_INACTIVE: { status: 409, msg: () => "This customer account is inactive." },
  ORDER_NOT_FOUND: { status: 404, msg: () => "Order not found." },
  INVALID_TRANSITION: { status: 409, msg: (d) => `Order cannot move from ${d?.from} to ${d?.to}.` },
  CREDIT_LIMIT_EXCEEDED: { status: 409, msg: () => "Approving this order would exceed the customer's credit limit." },
  INVENTORY_NOT_FOUND: { status: 404, msg: () => "No stock record for this product in that warehouse." },
  ADJUST_BELOW_RESERVED: {
    status: 409,
    msg: (d) => `Stock can't go below the ${d?.reserved} units reserved for open orders.`,
  },
  CUSTOMER_NOT_FOUND: { status: 404, msg: () => "Customer not found." },
  USER_NOT_FOUND: { status: 404, msg: () => "User not found." },
  MFA_REQUIRED: { status: 403, msg: () => "Verify with your authenticator app first (Account → Two-factor)." },
  PAYMENT_EXCEEDS_DUE: {
    status: 409,
    msg: (d) => `Payment is more than the amount due (₹${Number(d?.due ?? 0).toLocaleString("en-IN")}).`,
  },
  CONFLICT: { status: 409, msg: () => "This record was changed by someone else. Refresh and retry." },
};

function parseDetails(raw: unknown): Record<string, unknown> | undefined {
  if (raw && typeof raw === "object") return raw as Record<string, unknown>;
  if (typeof raw !== "string" || raw === "") return undefined;
  try {
    const v = JSON.parse(raw);
    return v && typeof v === "object" ? v : undefined;
  } catch {
    return undefined;
  }
}

/** Accepts a PostgrestError ({code,message,details}) or a node-postgres error ({code,message,detail}). */
export function toAppError(err: unknown): AppError {
  const e = (err ?? {}) as { code?: string; message?: string; details?: unknown; detail?: unknown };
  if (e.code === "P0001" && e.message && e.message in KNOWN) {
    const code = e.message as keyof typeof KNOWN;
    const details = parseDetails(e.details ?? e.detail);
    return { code, status: KNOWN[code].status, message: KNOWN[code].msg(details), details };
  }
  if (e.code === "42501") return { code: "FORBIDDEN", status: 403, message: KNOWN.FORBIDDEN.msg({}) };
  if (e.code === "23505") return { code: "CONFLICT", status: 409, message: KNOWN.CONFLICT.msg({}) };
  if (e.code === "23514" || e.code === "22P02" || e.code === "23502")
    return { code: "VALIDATION", status: 422, message: KNOWN.VALIDATION.msg({}) };
  if (e.code === "PGRST301" || e.code === "PGRST303")
    return { code: "UNAUTHENTICATED", status: 401, message: KNOWN.UNAUTHENTICATED.msg({}) };
  return { code: "INTERNAL", status: 500, message: "Something went wrong. Please try again." };
}
