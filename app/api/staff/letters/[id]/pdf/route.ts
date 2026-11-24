import { NextResponse } from "next/server";
import { requireStaff } from "@/lib/auth";
import { buildWarningLetterPdf } from "@/lib/warning-letter-pdf";
import { canSeeLetter, getLetter, letterFileName, letterPdfData } from "@/lib/warning-letters";

export const runtime = "nodejs";

// The letter as a PDF on the letterhead (with the acknowledgement once given).
export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireStaff();
  if (auth.response) return auth.response;
  const { id } = await params;
  const letter = await getLetter(id);
  if (!letter || !canSeeLetter(auth.staff, letter)) return NextResponse.json({ error: "Letter not found." }, { status: 404 });
  const pdf = await buildWarningLetterPdf(letterPdfData(letter));
  return new NextResponse(Buffer.from(pdf), {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `inline; filename="${letterFileName(letter)}"`,
      "Cache-Control": "private, no-store",
    },
  });
}
