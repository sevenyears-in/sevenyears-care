import { NextResponse } from "next/server";
import { requireStaff } from "@/lib/auth";
import { canWriteLetters, setSignature, signatureFor } from "@/lib/warning-letters";

// The name and title printed under "For Seven Years," on the letters this person issues.
export async function GET() {
  const auth = await requireStaff();
  if (auth.response) return auth.response;
  return NextResponse.json(await signatureFor(auth.staff));
}

export async function POST(request: Request) {
  const auth = await requireStaff();
  if (auth.response) return auth.response;
  if (!canWriteLetters(auth.staff.role)) return NextResponse.json({ error: "Only people who issue letters have a signature." }, { status: 403 });
  const body = (await request.json().catch(() => ({}))) as { name?: string; title?: string };
  await setSignature(auth.staff, String(body.name ?? ""), String(body.title ?? ""));
  return NextResponse.json({ ok: true, ...(await signatureFor(auth.staff)) });
}
