import { NextResponse } from "next/server";
import { webPushConfig } from "@/lib/push";

// GET /api/push/web-config — public Firebase settings so the website can ask for notifications.
export async function GET() {
  try {
    const config = await webPushConfig();
    if (!config) return NextResponse.json({ error: "Notifications are not set up." }, { status: 503 });
    return NextResponse.json({ config }, { headers: { "Cache-Control": "public, max-age=3600" } });
  } catch (error) {
    console.error("Web push config error:", error);
    return NextResponse.json({ error: "Not available." }, { status: 503 });
  }
}
