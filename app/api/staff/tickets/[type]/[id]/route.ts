import { after, NextResponse } from "next/server";
import { requireStaff } from "@/lib/auth";
import { runAction, type ActionInput, type ActionName } from "@/lib/tickets";

// POST /api/staff/tickets/service/<id>   or   /api/staff/tickets/complaint/<id>
// Body: { action, note?, customerNote?, severity?, priority?, assigneeId?, resolutionType?, visibility? }

const ACTIONS: ActionName[] = [
  "acknowledge",
  "triage",
  "assign",
  "start",
  "awaiting_parts",
  "request_approval",
  "approve",
  "reject",
  "resolve",
  "close",
  "reopen",
  "cancel",
  "note",
];

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
