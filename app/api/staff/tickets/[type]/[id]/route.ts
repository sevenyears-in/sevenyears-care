import { deleteTicket } from "@/lib/admin-delete";
import { after, NextResponse } from "next/server";
import { purgeServicePhotos } from "@/lib/service-photos";
import { requireStaff } from "@/lib/auth";
import { runAction, type ActionInput, type ActionName } from "@/lib/tickets";

// POST /api/staff/tickets/service/<id>   or   /api/staff/tickets/complaint/<id>
// Body: { action, note?, customerNote?, severity?, priority?, assigneeId?, resolutionType?, visibility? }

// Every action must be listed here (TypeScript refuses to build if one is missing).
const ACTION_SET: Record<ActionName, true> = {
  acknowledge: true,
  take_ownership: true,
  triage: true,
  assign: true,
  classify_assign: true,
  start: true,
  awaiting_parts: true,
  request_approval: true,
  approve: true,
  reject: true,
  resolve: true,
  close: true,
  reopen: true,
  cancel: true,
  note: true,
};
const ACTIONS = Object.keys(ACTION_SET) as ActionName[];

function text(value: unknown, max = 2000) {
  return typeof value === "string" ? value.trim().slice(0, max) : undefined;
}

export async function POST(request: Request, { params }: { params: Promise<{ type: string; id: string }> }) {
  const auth = await requireStaff("staff");
  if (auth.response) return auth.response;

  const { type, id } = await params;
  if (type !== "service" && type !== "complaint") {
    return NextResponse.json({ error: "Unknown request type." }, { status: 404 });
  }

  const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
  const action = body.action as ActionName;
  if (!ACTIONS.includes(action)) {
    return NextResponse.json({ error: "Unknown action." }, { status: 400 });
  }

  const input: ActionInput = {
    action,
    note: text(body.note),
    customerNote: text(body.customerNote),
    severity: text(body.severity, 30),
    priority: text(body.priority, 30),
    assigneeId: text(body.assigneeId, 40),
    resolutionType: text(body.resolutionType, 40),
    visibility: body.visibility === "customer" ? "customer" : "internal",
  };

  try {
    const result = await runAction(auth.staff, type, id, input);
    if (!result.ok) {
      return NextResponse.json({ error: result.error }, { status: result.status ?? 400 });
    }

    // Closed / cancelled service request: delete its photos for good.
    if (type === "service" && (action === "close" || action === "cancel")) {
      after(() => purgeServicePhotos(id).then(() => undefined).catch((error) => console.error("Photo delete failed:", error)));
    }

    if (result.followUp) {
      const followUp = result.followUp;
      after(() => followUp().catch((error) => console.error("Ticket notifications failed:", error)));
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Ticket action error:", error);
    return NextResponse.json({ error: "Unable to save. Please try again." }, { status: 500 });
  }
}

// DELETE /api/staff/tickets/<type>/<id> — Super Admin only: remove the request for good.
export async function DELETE(_request: Request, { params }: { params: Promise<{ type: string; id: string }> }) {
  const auth = await requireStaff("super_admin");
  if (auth.response) return auth.response;
  const { type, id } = await params;
  if ((type !== "service" && type !== "complaint") || !/^[0-9a-f-]{36}$/i.test(id)) {
    return NextResponse.json({ error: "Not found." }, { status: 404 });
  }
  try {
    await deleteTicket(type, id);
    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Delete ticket error:", error);
    return NextResponse.json({ error: "Unable to delete. Please try again." }, { status: 500 });
  }
}
