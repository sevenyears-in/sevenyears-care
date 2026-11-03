import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/server";
import { cleanMobile, isValidMobile } from "@/lib/helpers";
import { feedbackLink } from "@/lib/feedback-token";
import { loadFeedbackSubject, savedFeedback, zohoBillFeedbackId } from "@/lib/feedback";
import { resolveComplaintReference } from "@/lib/complaint-reference";

// POST /api/feedback/find  { mobile, number }
// number = bill number (sales), SY-SRV-… (service) or SY-CMP-… (complaint) → the feedback link.

export async function POST(request: Request) {
  try {
    const body = (await request.json().catch(() => ({}))) as { mobile?: string; number?: string };
    const mobile = cleanMobile(body.mobile);
    const number = String(body.number ?? "").toUpperCase().replace(/[^A-Z0-9\-/]/g, "").slice(0, 60);
    if (!isValidMobile(mobile)) return NextResponse.json({ error: "Enter your 10-digit mobile number." }, { status: 400 });
    if (number.length < 4) return NextResponse.json({ error: "Enter your bill, service request or complaint number." }, { status: 400 });

    const notFound = NextResponse.json(
      { error: "We couldn't find this number with your mobile. Please check both and try again." },
      { status: 404 }
    );

    let kind: "sales" | "service" | "complaint";
    let id: string;
    if (number.startsWith("SY-SRV-")) {
      const { data } = await supabaseAdmin
        .from("service_requests")
        .select("id, status, contact_mobile")
        .eq("request_number", number)
        .maybeSingle();
      if (!data || data.contact_mobile !== mobile) return notFound;
      if (!["resolved", "closed"].includes(data.status)) {
        return NextResponse.json(
          { error: "You can rate the service once the work is completed. We'll send you the link." },
          { status: 409 }
        );
      }
      kind = "service";
      id = data.id;
    } else if (number.startsWith("SY-CMP-")) {
      const { data } = await supabaseAdmin
        .from("complaints")
        .select("id, status, contact_mobile")
        .eq("complaint_number", number)
        .maybeSingle();
      if (!data || data.contact_mobile !== mobile) return notFound;
      if (!["resolved", "closed"].includes(data.status)) {
        return NextResponse.json(
          { error: "You can rate how we handled it once your complaint is resolved. We'll send you the link." },
          { status: 409 }
        );
      }
      kind = "complaint";
      id = data.id;
    } else {
      // Bill or warranty number — the same lookup as complaints (registered warranty, else the bill in Zoho POS).
      const { data } = await supabaseAdmin
        .from("warranties")
        .select("id")
        .or(`bill_number.ilike.${number},warranty_number.eq.${number}`)
        .eq("customer_mobile", mobile)
        .order("created_at", { ascending: true })
        .limit(1);
      kind = "sales";
      if (data?.length) {
        id = data[0].id;
      } else {
        const resolved = await resolveComplaintReference(number, mobile);
        if (!resolved.ok) {
          return NextResponse.json(
            { error: "We couldn't find this bill. Please type it exactly as printed on your bill (e.g. VDK26-SI1-8504)." },
            { status: 404 }
          );
        }
        id = resolved.value.warrantyId ?? zohoBillFeedbackId(resolved.value.billNumber, mobile);
      }
    }

    const subject = await loadFeedbackSubject(kind, id);
    if (!subject) return notFound;
    const saved = await savedFeedback(subject);
    const pendingConfirm = kind === "complaint" && subject.status === "resolved" && !saved?.resolved;
    if (saved?.rated && !pendingConfirm) {
      return NextResponse.json({ error: "You have already shared your feedback for this. Thank you!" }, { status: 409 });
    }
    return NextResponse.json({ url: feedbackLink(kind, id) });
  } catch (error) {
    console.error("Feedback find error:", error);
    return NextResponse.json({ error: "Something went wrong. Please try again." }, { status: 500 });
  }
}
