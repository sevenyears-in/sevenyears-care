import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { getCurrentStaff } from "@/lib/auth";
import { publicOrigin } from "@/lib/origin";
import { loadZohoSettings, saveZohoSettings, zohoConfig } from "@/lib/zoho";

// GET /api/staff/zoho/callback — Zoho sends the admin back here after "Accept".
// Swaps the one-time code for a permanent refresh token and finds the organisation.

export async function GET(request: Request) {
  const url = new URL(request.url);
  const origin = publicOrigin(request);
  const back = (query: string) => {
    const response = NextResponse.redirect(`${origin}/staff/admin/zoho?${query}`);
    response.cookies.set("sy_zoho_state", "", { path: "/", maxAge: 0 });
    return response;
  };

  const staff = await getCurrentStaff();
  if (!staff || staff.role !== "admin") return NextResponse.redirect(`${origin}/staff/login`);

  const cookieStore = await cookies();
  const expectedState = cookieStore.get("sy_zoho_state")?.value;
  const state = url.searchParams.get("state");
  const code = url.searchParams.get("code");
  const zohoError = url.searchParams.get("error");

  if (zohoError) return back(`error=${encodeURIComponent(zohoError)}`);
  if (!code || !state || !expectedState || state !== expectedState) {
    return back("error=state-mismatch");
  }

  // Zoho may say which data centre the account belongs to.
  const accountsServer = url.searchParams.get("accounts-server");

  try {
    const config = await zohoConfig();
    const accountsUrl =
      accountsServer && /^https:\/\/accounts\.zoho\.[a-z.]+$/.test(accountsServer)
        ? accountsServer
        : config.accountsUrl;

    const tokenResponse = await fetch(`${accountsUrl}/oauth/v2/token`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        code,
        client_id: config.clientId,
        client_secret: config.clientSecret,
        redirect_uri: `${origin}/api/staff/zoho/callback`,
        grant_type: "authorization_code",
      }),
      cache: "no-store",
    });
    const token = (await tokenResponse.json().catch(() => ({}))) as {
      access_token?: string;
      refresh_token?: string;
      error?: string;
      api_domain?: string;
    };

    if (!token.refresh_token || !token.access_token) {
      console.error("Zoho token exchange failed:", token.error ?? tokenResponse.status);
      return back(`error=${encodeURIComponent(token.error ?? "token-exchange-failed")}`);
    }

    // Find the organisation(s)
    let organizations: { id: string; name: string }[] = [];
    let orgError = "";
    try {
      const orgResponse = await fetch(`${config.apiUrl}/inventory/v1/organizations`, {
        headers: { Authorization: `Zoho-oauthtoken ${token.access_token}` },
        cache: "no-store",
      });
      const orgs = (await orgResponse.json().catch(() => ({}))) as {
        organizations?: { organization_id: string | number; name: string }[];
        message?: string;
      };
      organizations = (orgs.organizations ?? []).map((o) => ({
        id: String(o.organization_id),
        name: o.name,
      }));
      if (!orgResponse.ok) orgError = orgs.message ?? String(orgResponse.status);
    } catch (error) {
      orgError = String(error);
    }

    const saved = await loadZohoSettings();
    const single = organizations.length === 1 ? organizations[0] : null;

    await saveZohoSettings({
      ...saved,
      accountsUrl,
      refreshToken: token.refresh_token,
      organizations,
      organizationId: single?.id ?? "",
      organizationName: single?.name ?? null,
      connectedAt: new Date().toISOString(),
      lastOrgError: orgError || null,
    });

    return back(single ? "connected=1" : organizations.length > 1 ? "choose-org=1" : "connected=1&org-missing=1");
  } catch (error) {
    console.error("Zoho callback error:", error);
    return back("error=save-failed");
  }
}
