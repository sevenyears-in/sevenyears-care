import { NextResponse } from "next/server";
import { cleanMobile } from "@/lib/helpers";
import { resetCustomerPasswordWithProof } from "@/lib/customer-auth";

// POST /api/account/forgot { mobile, proof, password } → customer sets a new password.

export async function POST(request: Request) {
  const body = (await request.json().catch(() => ({}))) as { mobile?: string; proof?: string; password?: string };
  const result = await resetCustomerPasswordWithProof(cleanMobile(body.mobile), String(body.proof ?? ""), String(body.password ?? ""));
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: result.status });
  return NextResponse.json({ success: true });
}
