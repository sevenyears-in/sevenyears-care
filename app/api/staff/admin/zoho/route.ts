import { NextResponse } from "next/server";
import { requireStaff } from "@/lib/auth";
import { publicOrigin } from "@/lib/origin";
import { listZohoOrganizations, loadZohoSettings, previousZohoOrgs, probeZohoOrganization, saveZohoSettings, skippedBillPrefixes, zohoConfig, zohoDayBills, zohoInvoiceDetail } from "@/lib/zoho";
import { logAudit } from "@/lib/audit";

// Super Admin only: Zoho POS connection settings (stored server-side in Supabase).
// GET    → status (never returns the secret or tokens)
// POST   → save Client ID + Client Secret        { clientId, clientSecret }
// PATCH  → choose organisation                     { organizationId, previousOrganizations?: [{ id, until }] }
//          Earlier organisations are still read for their bills (warranty, history, sales up to `until`).
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

  // ?check=1 → organisations this login can open, with a look at each one's bills since a date
  // (read only; nothing is saved). Used when the business moved to a new Zoho organisation.
  const url = new URL(request.url);
  // ?compare=YYYY-MM-DD → that day's bills in every organisation (read only), to see whether two
  // organisations hold the same bills.
  // ?invoice=NUMBER → that invoice in full (read only).
  const invoice = (url.searchParams.get("invoice") ?? "").trim();
  if (invoice) {
    try {
      const detail = await zohoInvoiceDetail(invoice.slice(0, 40));
      return detail ? NextResponse.json(detail) : NextResponse.json({ error: "Not found." }, { status: 404 });
    } catch (e) {
      return NextResponse.json({ error: e instanceof Error ? e.message : "Could not reach Zoho POS." }, { status: 502 });
    }
  }
  const compare = url.searchParams.get("compare") ?? "";
  if (/^\d{4}-\d{2}-\d{2}$/.test(compare)) {
    try {
      const orgs = await listZohoOrganizations();
      const result = [];
      for (const o of orgs) result.push({ ...o, bills: await zohoDayBills(o.id, compare).catch((e) => ({ error: e instanceof Error ? e.message : String(e) })) });
      return NextResponse.json({ date: compare, organizations: result });
    } catch (e) {
      return NextResponse.json({ error: e instanceof Error ? e.message : "Could not reach Zoho POS." }, { status: 502 });
    }
  }
  if (url.searchParams.get("check")) {
    const from = /^\d{4}-\d{2}-\d{2}$/.test(url.searchParams.get("from") ?? "") ? (url.searchParams.get("from") as string) : "2026-10-25";
    try {
      const orgs = await listZohoOrganizations();
      const result = [];
      for (const o of orgs) {
        result.push({ ...o, current: o.id === config.organizationId, bills: await probeZohoOrganization(o.id, from).catch((e) => ({ error: e instanceof Error ? e.message : String(e) })) });
      }
      return NextResponse.json({ from, organizations: result });
    } catch (e) {
      return NextResponse.json({ error: e instanceof Error ? e.message : "Could not reach Zoho POS." }, { status: 502 });
    }
  }

  return NextResponse.json({
    usingEnvFile: Boolean(process.env.ZOHO_REFRESH_TOKEN),
    clientIdMasked: mask(config.clientId),
    hasClientSecret: Boolean(config.clientSecret),
    connected: Boolean(config.refreshToken),
    organizationId: config.organizationId || null,
    organizationName: (saved.organizationName as string) ?? null,
    organizations: (saved.organizations as { id: string; name: string }[]) ?? [],
    previousOrganizations: previousZohoOrgs(saved),
    skipBillPrefixes: skippedBillPrefixes(saved),
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
  const organizationId = String(body.organizationId ?? "").trim();
  const saved = await loadZohoSettings();
  let orgs = (saved.organizations as { id: string; name: string }[]) ?? [];
  // Names (and the list) as Zoho has them now, e.g. after a new organisation was added to the login.
  const fresh = await listZohoOrganizations().catch(() => [] as { id: string; name: string }[]);
  if (fresh.length) orgs = fresh;
  const before = previousZohoOrgs(saved);
  const nameOf = (id: string) => orgs.find((o) => o.id === id)?.name || before.find((o) => o.id === id)?.name || (id === String(saved.organizationId ?? "") ? String(saved.organizationName ?? "") : "");
  if (!/^\d{5,20}$/.test(organizationId)) return NextResponse.json({ error: "Enter a valid Organisation ID (numbers only)." }, { status: 400 });

  // Earlier organisations: as sent, or (when not sent) the old current one is kept as an earlier one,
  // so its bills can still be found.
  let previous = before;
  if (Array.isArray(body.previousOrganizations)) {
    previous = [];
    for (const p of body.previousOrganizations as { id?: unknown; until?: unknown }[]) {
      const id = String(p?.id ?? "").trim();
      const until = String(p?.until ?? "").trim();
      if (!/^\d{5,20}$/.test(id)) return NextResponse.json({ error: `"${id}" is not a valid Organisation ID.` }, { status: 400 });
      if (until && !/^\d{4}-\d{2}-\d{2}$/.test(until)) return NextResponse.json({ error: "The last billing day must be a date." }, { status: 400 });
      if (id === organizationId || previous.some((x) => x.id === id)) continue;
      previous.push({ id, name: nameOf(id), until: until || null });
    }
  } else {
    const old = String(saved.organizationId ?? "");
    if (old && old !== organizationId && !previous.some((x) => x.id === old)) previous = [...previous, { id: old, name: nameOf(old), until: null }];
    previous = previous.filter((x) => x.id !== organizationId);
  }

  // Bill-number starts not counted as sales (as sent, otherwise unchanged).
  const skip = Array.isArray(body.skipBillPrefixes)
    ? skippedBillPrefixes({ skipBillPrefixes: (body.skipBillPrefixes as unknown[]).map((p) => String(p ?? "").slice(0, 30)) })
    : skippedBillPrefixes(saved);

  await saveZohoSettings({ ...saved, organizations: orgs, organizationId, organizationName: nameOf(organizationId) || null, previousOrganizations: previous, skipBillPrefixes: skip });
  await logAudit(
    auth.staff,
    "zoho",
    "organisation",
    { organizationId: saved.organizationId ?? null, previousOrganizations: before, skipBillPrefixes: skippedBillPrefixes(saved) },
    { organizationId, previousOrganizations: previous, skipBillPrefixes: skip }
  ).catch(() => undefined);
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
