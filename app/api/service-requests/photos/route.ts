import { NextResponse } from "next/server";
import { createUploadSlots } from "@/lib/service-photos";

// POST /api/service-requests/photos { count } → one-time upload links (max 3).
// The photos stay in a temporary folder until the service request is saved;
// unsent ones are deleted automatically after 2 days.
export async function POST(request: Request) {
  const body = (await request.json().catch(() => ({}))) as { count?: number };
  try {
    return NextResponse.json({ slots: await createUploadSlots(Number(body.count) || 1) });
  } catch (error) {
    console.error("Photo upload links error:", error);
    return NextResponse.json({ error: "Photo upload is not available right now. Please try again." }, { status: 503 });
  }
}
