import { NextResponse } from "next/server";
import { logCctvRequest, requestNote } from "@/lib/cctv";

// Any other call under /api/cctv/ (e.g. a recorder that adds to the URL or a trailing slash):
// noted in Settings → CCTV → "What the recorders sent", so a wrong address shows up there.
async function other(request: Request) {
  await logCctvRequest({ ...requestNote(request), store: null, error: "Wrong address — check the URL on the recorder" });
  return NextResponse.json({ error: "Wrong address." }, { status: 404 });
}

export const GET = other;
export const POST = other;
export const PUT = other;
export const HEAD = other;
