import { NextResponse } from "next/server";
import { requireStaff } from "@/lib/auth";
import { isISODate } from "@/lib/helpers";
import { zohoConfigured } from "@/lib/zoho";
import { loadImportState, runImportBatch, startImport } from "@/lib/zoho-import";

// Super Admin: bulk-import warranties from Zoho POS bills.
// GET  → current progress
// POST { action: "start", from, to } → start (or restart) an import
// POST { action: "next" }            → process the next few bills

export async function GET() {
  const auth = await requireStaff("super_admin");
  if (auth.response) return auth.response;
  return NextResponse.json({ state: await loadImportState() });
}

export async function POST(request: Request) {
  const auth = await requireStaff("super_admin");
  if (auth.response) return auth.response;

  try {
    const body = await request.json().catch(() => ({}));
    if (body.action === "start") {
      const from = String(body.from ?? "");
      const to = String(body.to ?? "");
      if (!isISODate(from) || !isISODate(to) || from > to) {
        return NextResponse.json({ error: "Choose a valid date range." }, { status: 400 });
      }
      if (!(await zohoConfigured())) {
        return NextResponse.json({ error: "Zoho POS is not connected yet." }, { status: 400 });
      }
      return NextResponse.json({ state: await startImport(from, to, auth.staff.fullName) });
    }
    if (body.action === "next") {
      return NextResponse.json(await runImportBatch(auth.staff.id));
    }
    return NextResponse.json({ error: "Unknown action." }, { status: 400 });
  } catch (error) {
    console.error("Zoho import error:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Import failed. Please try again." },
      { status: 500 }
    );
  }
}
