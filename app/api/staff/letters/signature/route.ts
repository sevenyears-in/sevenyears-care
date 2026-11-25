import { NextResponse } from "next/server";
import { requireStaff } from "@/lib/auth";
import { canWriteLetters, setSignature, setSignatureImage, signatureFor } from "@/lib/warning-letters";

// The name and title printed under "For Seven Years Kids Care LLP," on the letters this person issues.
export async function GET() {
  const auth = await requireStaff();
  if (auth.response) return auth.response;
  return NextResponse.json(await signatureFor(auth.staff));
}

export async function POST(request: Request) {
  const auth = await requireStaff();
  if (auth.response) return auth.response;
  if (!canWriteLetters(auth.staff.role)) return NextResponse.json({ error: "Only people who issue letters have a signature." }, { status: 403 });
  const body = (await request.json().catch(() => ({}))) as { name?: string; title?: string; image?: string; removeImage?: boolean };
  try {
    if (body.removeImage) await setSignatureImage(auth.staff, null);
    else if (typeof body.image === "string") {
      // data:image/png;base64,....
      const m = /^data:(image\/(?:png|jpeg));base64,([A-Za-z0-9+/=]+)$/.exec(body.image);
      if (!m) return NextResponse.json({ error: "Use a PNG or JPG picture of the signature." }, { status: 400 });
      await setSignatureImage(auth.staff, { bytes: new Uint8Array(Buffer.from(m[2], "base64")), type: m[1] });
    } else await setSignature(auth.staff, String(body.name ?? ""), String(body.title ?? ""));
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "Could not save." }, { status: 400 });
  }
  return NextResponse.json({ ok: true, ...(await signatureFor(auth.staff)) });
}
