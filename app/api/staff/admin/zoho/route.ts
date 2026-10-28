import { NextResponse } from "next/server";
import { requireStaff } from "@/lib/auth";
import { publicOrigin } from "@/lib/origin";
import { loadZohoSettings, saveZohoSettings, zohoConfig } from "@/lib/zoho";

// Super Admin only: Zoho POS connection settings (stored server-side in Supabase).
// GET    → status (never returns the secret or tokens)
// POST   → save Client ID + Client Secret        { clientId, clientSecret }
// PATCH  → choose organisation                     { organizationId }
// DELETE → disconnect

function mask(value: string) {
  return value.length > 10 ? `${value.slice(0, 9)}…${value.slice(-4)}` : value ? "••••" : "";
}

export async function GET(request: Request) {
  const auth = await requireStaff("super_admin");
  if (auth.response) return auth.response;

  const saved = await loadZohoSettings();
  const config = await zohoConfig();
  const origin = publicOrigin(request);

  return NextResponse.json({
    usingEnvFile: Boolean(process.env.ZOHO_REFRESH_TOKEN),
    clientIdMasked: mask(config.clientId),
    hasClientSecret: Boolean(config.clientSecret),
    connected: Boolean(config.refreshToken),
    organizationId: config.organizationId || null,
    organizationName: (saved.organizationName as string) ?? null,
    organizations: (saved.organizations as { id: string; name: string }[]) ?? [],
    connectedAt: (saved.connectedAt as string) ?? null,
    redirectUri: `${origin}/api/staff/zoho/callback`,
    homepageUrl: origin,
  });
}

export async function POST(request: Request) {
  const auth = await requireStaff("super_admin");
  if (auth.response) return auth.response;

  const body = await request.json().catch(() => ({}));
  const clientId = String(body.clientId ?? "").trim();
  const clientSecret = String(body.clientSecret ?? "").trim();

  if (!/^1000\.[A-Z0-9]{10,}$/i.test(clientId)) {
    return NextResponse.json(
      { error: "That doesn't look like a Zoho Client ID (it starts with 1000.)." },
      { status: 400 }
    );
  }
  if (clientSecret.length < 20) {
    return NextResponse.json({ error: "Paste the full Client Secret." }, { status: 400 });
  }

  try {
    const saved = await loadZohoSettings();
    await saveZohoSettings({
      ...saved,
      clientId,
      clientSecret,
      // new keys → must connect again
      refreshToken: "",
      organizationId: "",
      organizationName: null,
      organizations: [],
    });
    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Save Zoho keys error:", error);
    return NextResponse.json(
      { error: "Unable to save. Has the app_settings table been created in Supabase?" },
      { status: 500 }
    );
  }
}

export async function PATCH(request: Request) {
  const auth = await requireStaff("super_admin");
  if (auth.response) return auth.response;

  const body = await request.json().catch(() => ({}));
  const organizationId = String(body.organizationId ?? "");
  const saved = await loadZohoSettings();
  const orgs = (saved.organizations as { id: string; name: string }[]) ?? [];
  const org =
    orgs.find((o) => o.id === organizationId) ??
    (/^\d{5,20}$/.test(organizationId) ? { id: organizationId, name: "" } : null);

  if (!org) return NextResponse.json({ error: "Enter a valid Organisation ID (numbers only)." }, { status: 400 });

  await saveZohoSettings({ ...saved, organizationId: org.id, organizationName: org.name || null });
  return NextResponse.json({ success: true });
}

export async function DELETE() {
  const auth = await requireStaff("super_admin");
  if (auth.response) return auth.response;

  const saved = await loadZohoSettings();
  await saveZohoSettings({
    ...saved,
    refreshToken: "",
    organizationId: "",
    organizationName: null,
    organizations: [],
    connectedAt: null,
  });
  return NextResponse.json({ success: true });
}
