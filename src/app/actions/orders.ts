"use server";
// Server Actions are public HTTP endpoints: each one re-checks auth, validates
// input with zod, calls a single transactional RPC, and returns a safe Result.
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { getViewer } from "@/lib/auth";
import { ORDER_STATUSES, adjustStockSchema, placeOrderSchema, receiveStockSchema,
         type OrderStatus, type Role } from "@/lib/domain";
import { toAppError, type Result } from "@/lib/errors";

async function guard(roles: Role[]) {
  const viewer = await getViewer();
  if (!viewer) return { error: toAppError({ code: "P0001", message: "UNAUTHENTICATED" }) } as const;
  if (!roles.includes(viewer.role)) return { error: toAppError({ code: "P0001", message: "FORBIDDEN" }) } as const;
  return { viewer } as const;
}

function invalid(err: z.ZodError): Result<never> {
  return { ok: false, error: { code: "VALIDATION", status: 422, message: err.issues[0]?.message ?? "Invalid input." } };
}

function fail(e: unknown): Result<never> {
  const error = toAppError(e);
  if (error.code === "INTERNAL") console.error("[orders] unexpected error", e); // server logs only
  return { ok: false, error };
}

export async function placeOrderAction(input: unknown): Promise<Result<{ orderId: string }>> {
  const g = await guard(["customer", "sales", "manager", "admin"]);
  if ("error" in g) return { ok: false, error: g.error! };
  const parsed = placeOrderSchema.safeParse(input);
  if (!parsed.success) return invalid(parsed.error);
  // Buyers can only order for their own account (the DB enforces this too).
  const customerId = g.viewer.role === "customer" ? g.viewer.customerId! : parsed.data.customer_id;

  const supabase = await createClient();
  const { data, error } = await supabase.rpc("place_order", {
    p_customer_id: customerId,
    p_items: parsed.data.items,
    p_idempotency_key: parsed.data.idempotency_key,
    p_notes: parsed.data.notes ?? null,
  });
  if (error) return fail(error);
  revalidatePath("/orders");
  revalidatePath("/catalog");
  return { ok: true, data: { orderId: data as string } };
}

const transitionSchema = z.object({ orderId: z.uuid(), to: z.enum(ORDER_STATUSES), note: z.string().max(500).optional() });

export async function transitionOrderAction(input: unknown): Promise<Result<{ status: OrderStatus }>> {
  const g = await guard(["customer", "sales", "warehouse", "manager", "admin"]);
  if ("error" in g) return { ok: false, error: g.error! };
  const parsed = transitionSchema.safeParse(input);
  if (!parsed.success) return invalid(parsed.error);

  const supabase = await createClient();
  const { data, error } = await supabase.rpc("transition_order", {
    p_order_id: parsed.data.orderId, p_to: parsed.data.to, p_note: parsed.data.note ?? null,
  });
  if (error) return fail(error);
  revalidatePath(`/orders/${parsed.data.orderId}`);
  revalidatePath("/orders");
  return { ok: true, data: { status: data as OrderStatus } };
}

export async function receiveStockAction(input: unknown): Promise<Result<{ onHand: number }>> {
  const g = await guard(["warehouse", "manager", "admin"]);
  if ("error" in g) return { ok: false, error: g.error! };
  const parsed = receiveStockSchema.safeParse(input);
  if (!parsed.success) return invalid(parsed.error);
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("receive_stock", {
    p_product_id: parsed.data.product_id, p_warehouse_id: parsed.data.warehouse_id,
    p_quantity: parsed.data.quantity, p_reason: parsed.data.reason ?? null,
  });
  if (error) return fail(error);
  revalidatePath("/inventory");
  return { ok: true, data: { onHand: data as number } };
}

export async function adjustStockAction(input: unknown): Promise<Result<{ onHand: number }>> {
  const g = await guard(["manager", "admin"]);
  if ("error" in g) return { ok: false, error: g.error! };
  const parsed = adjustStockSchema.safeParse(input);
  if (!parsed.success) return invalid(parsed.error);
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("adjust_stock", {
    p_product_id: parsed.data.product_id, p_warehouse_id: parsed.data.warehouse_id,
    p_delta: parsed.data.delta, p_reason: parsed.data.reason,
  });
  if (error) return fail(error);
  revalidatePath("/inventory");
  return { ok: true, data: { onHand: data as number } };
}
