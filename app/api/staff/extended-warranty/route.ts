import { after, NextResponse } from "next/server";
import { requireStaff } from "@/lib/auth";
import { supabaseAdmin } from "@/lib/supabase/server";
import { applyExtension, extendedSettings, warrantyById } from "@/lib/extended-warranty";
import { extendLink, tellCustomerActive } from "@/lib/extended-notify";
import { notifyCustomer } from "@/lib/notify";
import { canHandleExtensions, sameStoreOrCorporate } from "@/lib/extended-access";
import { hasSection } from "@/lib/access";

// PATCH { id, action: "approve" | "reject" | "paid_store", note? }

export async function PATCH(request: Request) {
  const auth = await requireStaff("staff");
  if (auth.response) return auth.response;
  const staff = auth.staff;
  if (!hasSection(staff, "extended") || staff.role === "director") return NextResponse.json({ error: "Not allowed." }, { status: 403 });

  const body = (await request.json().catch(() => ({}))) as { id?: string; action?: string; note?: string };
  const note = String(body.note ?? "").trim().slice(0, 1000);
  const { data: req } = await supabaseAdmin.from("warranty_extensions").select("*").eq("id", String(body.id ?? "")).maybeSingle();
  if (!req) return NextResponse.json({ error: "Request not found." }, { status: 404 });
  if (!sameStoreOrCorporate(staff, req.store_name)) return NextResponse.json({ error: "Not your store." }, { status: 403 });
  const w = await warrantyById(String(req.warranty_id));
  if (!w) return NextResponse.json({ error: "Warranty not found." }, { status: 404 });

  if (body.action === "approve" || body.action === "reject") {
    if (req.status !== "pending_inspection") return NextResponse.json({ error: "This request is not waiting for inspection." }, { status: 409 });
    if (body.action === "reject" && note.length < 5) return NextResponse.json({ error: "Write why it can't be covered (the customer sees this)." }, { status: 400 });
    const s = await extendedSettings();
    const { error } = await supabaseAdmin
      .from("warranty_extensions")
      .update({
        status: body.action === "approve" ? "awaiting_payment" : "inspection_failed",
        inspection_note: note || null,
        inspected_by: staff.id,
        inspected_by_name: staff.fullName,
        inspected_at: new Date().toISOString(),
        price: s.price,
      })
      .eq("id", req.id)
      .eq("status", "pending_inspection");
    if (error) return NextResponse.json({ error: "Unable to save." }, { status: 500 });
    after(() =>
      notifyCustomer({
        name: w.customer_name,
        mobile: w.customer_mobile,
        ticketNumber: w.warranty_number,
        message:
          body.action === "approve"
            ? `Good news! Your ${w.product_name} passed the inspection. You can now buy the Extended Warranty (+${s.months} months) here:`
            : `We inspected your ${w.product_name}. Unfortunately it can't be covered by the Extended Warranty${note ? `: ${note}` : "."} Please contact the store for help.`,
        link: body.action === "approve" ? extendLink(w.verification_token) : undefined,
      }).catch((e) => console.error("Extension customer message failed:", e))
    );
    return NextResponse.json({ success: true });
  }

  if (body.action === "paid_store") {
    if (req.status !== "awaiting_payment") {
      return NextResponse.json({ error: "Only approved requests waiting for payment can be marked paid." }, { status: 409 });
    }
    const result = await applyExtension({ requestId: req.id, paymentMode: "store", staffName: staff.fullName });
    if (!result.ok) return NextResponse.json({ error: result.error }, { status: 500 });
    if (!result.already && result.expiry && result.warranty) {
      const warranty = result.warranty;
      const expiry = result.expiry;
      after(() => tellCustomerActive(warranty, expiry).catch((e) => console.error("Extension message failed:", e)));
    }
    return NextResponse.json({ success: true });
  }

  return NextResponse.json({ error: "Unknown action." }, { status: 400 });
}
