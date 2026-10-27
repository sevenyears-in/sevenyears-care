import { randomBytes } from "node:crypto";
import { NextResponse } from "next/server";
import { getCurrentStaff } from "@/lib/auth";
import { zohoConfig, ZOHO_SCOPES } from "@/lib/zoho";

// GET /api/staff/zoho/connect — sends the admin to Zoho's consent screen.

export async function GET(request: Request) {
  const origin = new URL(request.url).origin;
  const back = (query: string) => NextResponse.redirect(`${origin}/staff/admin/zoho?${query}`);

  const staff = await getCurrentStaff();
  if (!staff) return NextResponse.redirect(`${origin}/staff/login`);
  if (staff.role !== "admin") return NextResponse.redirect(`${origin}/staff`);

  const config = await zohoConfig();
  if (!config.clientId || !config.clientSecret) return back("error=keys-missing");

  const state = randomBytes(16).toString("hex");
  const authUrl = new URL(`${config.accountsUrl}/oauth/v2/auth`);
  authUrl.searchParams.set("scope", ZOHO_SCOPES);
  authUrl.searchParams.set("client_id", config.clientId);
  authUrl.searchParams.set("response_type", "code");
  authUrl.searchParams.set("access_type", "offline");
  authUrl.searchParams.set("prompt", "consent");
  authUrl.searchParams.set("redirect_uri", `${origin}/api/staff/zoho/callback`);
  authUrl.searchParams.set("state", state);

  const response = NextResponse.redirect(authUrl.toString());
  response.cookies.set("sy_zoho_state", state, {
    httpOnly: true,
    sameSite: "lax",
    secure: origin.startsWith("https://"),
    path: "/",
    maxAge: 10 * 60,
  });
  return response;
}
