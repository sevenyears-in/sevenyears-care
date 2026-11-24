import { NextResponse } from "next/server";
import { requireStaff } from "@/lib/auth";
import { canWriteLetters, isLetterKind, letterRecipients, letterTemplate } from "@/lib/warning-letters";

// GET ?staffId=…&kind=…&month=YYYY-MM → suggested subject and text, filled in from the records.
export async function GET(request: Request) {
  const auth = await requireStaff();
  if (auth.response) return auth.response;
  if (!canWriteLetters(auth.staff.role)) return NextResponse.json({ error: "You can't issue warning letters." }, { status: 403 });
  const url = new URL(request.url);
  const kind = url.searchParams.get("kind");
  const month = url.searchParams.get("month") ?? undefined;
  if (!isLetterKind(kind)) return NextResponse.json({ error: "Choose the type of warning." }, { status: 400 });
  const person = (await letterRecipients(auth.staff)).find((p) => p.id === url.searchParams.get("staffId"));
  if (!person) return NextResponse.json({ error: "Choose the staff member." }, { status: 400 });
  const t = await letterTemplate(kind, person, month && /^\d{4}-\d{2}$/.test(month) ? month : undefined);
  return NextResponse.json(t);
}
