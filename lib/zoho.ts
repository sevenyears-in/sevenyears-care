// Zoho POS (Zakya) API client — server only.
//
// Connect from the app: Staff → Zoho Connection (admin). Or, alternatively,
// .env.local settings (see ZOHO-SETUP.md):
//   ZOHO_CLIENT_ID=...
//   ZOHO_CLIENT_SECRET=...
//   ZOHO_REFRESH_TOKEN=...
//   ZOHO_ORGANIZATION_ID=...
//   ZOHO_ACCOUNTS_URL=https://accounts.zoho.in     (India data centre — default)
//   ZOHO_API_URL=https://api.zakya.in               (India — default)
//
// If any of the first four are missing the app runs in DEMO MODE and returns
// a sample bill, so the registration screens can be tested before Zoho is set up.

import { supabaseAdmin } from "@/lib/supabase/server";

export type BillLine = {
  lineItemId: string;
  itemId: string | null;
  name: string;
  sku: string | null;
  quantity: number;
  categoryName: string | null;
};

export type Bill = {
  invoiceId: string;
  billNumber: string;
  billDate: string; // YYYY-MM-DD
  storeName: string | null;
  customer: {
    name: string;
    mobile: string; // 10 digits, may be empty
    address: string;
  };
  lines: BillLine[];
  demo: boolean;
};

export class ZohoError extends Error {
  status: number;
  constructor(message: string, status = 502) {
    super(message);
    this.status = status;
  }
}

export type ZohoConfig = {
  clientId: string;
  clientSecret: string;
  refreshToken: string;
  organizationId: string;
  accountsUrl: string;
  apiUrl: string;
};

export const ZOHO_SETTINGS_KEY = "zoho";
export const ZOHO_SCOPES =
  "ZohoPOSAPI.invoices.READ,ZohoPOSAPI.items.READ,ZohoPOSAPI.contacts.READ,ZohoPOSAPI.settings.READ";

const trimUrl = (u: string) => u.replace(/\/$/, "");

/** Saved connection from Staff → Zoho Connection (Supabase app_settings). */
export async function loadZohoSettings(): Promise<Partial<ZohoConfig> & Record<string, unknown>> {
  try {
    const { data } = await supabaseAdmin
      .from("app_settings")
      .select("value")
      .eq("key", ZOHO_SETTINGS_KEY)
      .maybeSingle();
    return (data?.value as Partial<ZohoConfig>) ?? {};
  } catch {
    return {};
  }
}

export async function saveZohoSettings(value: Record<string, unknown>) {
  const { error } = await supabaseAdmin
    .from("app_settings")
    .upsert({ key: ZOHO_SETTINGS_KEY, value, updated_at: new Date().toISOString() });
  if (error) throw error;
  cachedToken = null;
}

/** .env.local values win; otherwise the connection saved in the app is used. */
export async function zohoConfig(): Promise<ZohoConfig> {
  const saved = await loadZohoSettings();
  return {
    clientId: process.env.ZOHO_CLIENT_ID || String(saved.clientId ?? ""),
    clientSecret: process.env.ZOHO_CLIENT_SECRET || String(saved.clientSecret ?? ""),
    refreshToken: process.env.ZOHO_REFRESH_TOKEN || String(saved.refreshToken ?? ""),
    organizationId: process.env.ZOHO_ORGANIZATION_ID || String(saved.organizationId ?? ""),
    accountsUrl: trimUrl(process.env.ZOHO_ACCOUNTS_URL || String(saved.accountsUrl || "https://accounts.zoho.in")),
    apiUrl: trimUrl(process.env.ZOHO_API_URL || String(saved.apiUrl || "https://api.zakya.in")),
  };
}

export async function zohoConfigured() {
  const c = await zohoConfig();
  return Boolean(c.clientId && c.clientSecret && c.refreshToken && c.organizationId);
}

// ------------------------------------------------------------------
// Access token (cached until ~5 min before expiry)
// ------------------------------------------------------------------

let cachedToken: { value: string; expiresAt: number } | null = null;

async function accessToken() {
  if (cachedToken && cachedToken.expiresAt > Date.now()) return cachedToken.value;

  const config = await zohoConfig();
  const params = new URLSearchParams({
    refresh_token: config.refreshToken,
    client_id: config.clientId,
    client_secret: config.clientSecret,
    grant_type: "refresh_token",
  });

  const response = await fetch(`${config.accountsUrl}/oauth/v2/token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: params,
    cache: "no-store",
  });

  const data = (await response.json().catch(() => ({}))) as {
    access_token?: string;
    expires_in?: number;
    error?: string;
  };

  if (!response.ok || !data.access_token) {
    console.error("Zoho token error:", data);
    throw new ZohoError(
      `Could not connect to Zoho POS (${data.error ?? response.status}). Check the Zoho keys in .env.local.`
    );
  }

  cachedToken = {
    value: data.access_token,
    expiresAt: Date.now() + Math.max(60, (data.expires_in ?? 3600) - 300) * 1000,
  };
  return cachedToken.value;
}

type ZohoJson = { code?: number; message?: string; [key: string]: unknown };

async function zohoGet(path: string, query: Record<string, string> = {}): Promise<ZohoJson> {
  const config = await zohoConfig();
  const url = new URL(`${config.apiUrl}/inventory/v1/${path}`);
  url.searchParams.set("organization_id", config.organizationId);
  for (const [key, value] of Object.entries(query)) url.searchParams.set(key, value);

  const response = await fetch(url, {
    headers: { Authorization: `Zoho-oauthtoken ${await accessToken()}` },
    cache: "no-store",
  });

  const data = (await response.json().catch(() => ({}))) as ZohoJson;

  if (response.status === 401) cachedToken = null;

  if (!response.ok || (typeof data.code === "number" && data.code !== 0)) {
    console.error(`Zoho GET ${path} failed:`, response.status, data);
    throw new ZohoError(`Zoho POS returned an error: ${data.message ?? response.status}`);
  }

  return data;
}

// ------------------------------------------------------------------
// Helpers to read loosely-typed Zoho JSON
// ------------------------------------------------------------------

type Obj = Record<string, unknown>;
const str = (value: unknown) => (value === null || value === undefined ? "" : String(value)).trim();
const obj = (value: unknown): Obj => (value && typeof value === "object" ? (value as Obj) : {});
const arr = (value: unknown): Obj[] => (Array.isArray(value) ? (value as Obj[]) : []);

function digits10(value: unknown) {
  const d = str(value).replace(/\D/g, "");
  return d.length >= 10 ? d.slice(-10) : "";
}

function formatAddress(address: unknown) {
  const a = obj(address);
  return [a.attention, a.address, a.street2, a.city, a.state, a.zip]
    .map(str)
    .filter(Boolean)
    .join(", ");
}

// ------------------------------------------------------------------
// Public: fetch a bill by number + date
// ------------------------------------------------------------------

export async function fetchBill(billNumber: string, billDate: string): Promise<Bill> {
  if (!(await zohoConfigured())) return demoBill(billNumber, billDate);

  const wanted = billNumber.trim().toUpperCase();

  const list = await zohoGet("invoices", { invoice_number: billNumber.trim() });
  const matches = arr(list.invoices).filter(
    (inv) => str(inv.invoice_number).toUpperCase() === wanted
  );

  if (matches.length === 0) {
    throw new ZohoError(`Bill ${billNumber} was not found in Zoho POS.`, 404);
  }

  const match = matches.find((inv) => str(inv.date) === billDate);
  if (!match) {
    const dates = matches.map((inv) => str(inv.date)).join(", ");
    throw new ZohoError(
      `Bill ${billNumber} exists but its date is ${dates}, not ${billDate}. Please check the bill date.`,
      404
    );
  }

  const detail = obj((await zohoGet(`invoices/${str(match.invoice_id)}`)).invoice);
  const lineItems = arr(detail.line_items);

  // Item categories are not on the bill lines, so look the items up.
  const itemIds = [...new Set(lineItems.map((l) => str(l.item_id)).filter(Boolean))];
  const categories = await fetchItemCategories(itemIds);

  // Customer mobile / address
  let mobile = "";
  let address = formatAddress(detail.billing_address);
  const customerId = str(detail.customer_id);

  for (const person of arr(detail.contact_persons_details ?? detail.contact_persons)) {
    mobile = mobile || digits10(person.mobile) || digits10(person.phone);
  }

  if (customerId && (!mobile || !address)) {
    try {
      const contact = obj((await zohoGet(`contacts/${customerId}`)).contact);
      mobile = mobile || digits10(contact.mobile) || digits10(contact.phone);
      address = address || formatAddress(contact.billing_address);
    } catch (error) {
      console.warn("Zoho contact lookup failed (continuing):", error);
    }
  }

  return {
    invoiceId: str(detail.invoice_id || match.invoice_id),
    billNumber: str(detail.invoice_number || match.invoice_number),
    billDate: str(detail.date || match.date),
    storeName:
      str(detail.location_name) || str(detail.branch_name) || str(detail.warehouse_name) || null,
    customer: {
      name: str(detail.customer_name || match.customer_name),
      mobile,
      address,
    },
    lines: lineItems.map((line) => {
      const itemId = str(line.item_id) || null;
      return {
        lineItemId: str(line.line_item_id),
        itemId,
        name: str(line.name) || str(line.description) || "Item",
        sku: str(line.sku) || null,
        quantity: Math.max(0, Math.floor(Number(line.quantity) || 0)),
        categoryName:
          str(line.category_name) || (itemId ? categories.get(itemId) ?? null : null),
      };
    }),
    demo: false,
  };
}

async function fetchItemCategories(itemIds: string[]) {
  const result = new Map<string, string>();
  if (itemIds.length === 0) return result;

  const readCategory = (item: Obj) =>
    str(item.category_name) || str(item.group_name) || "";

  try {
    const bulk = await zohoGet("itemdetails", { item_ids: itemIds.join(",") });
    for (const item of arr(bulk.items)) {
      const category = readCategory(item);
      if (category) result.set(str(item.item_id), category);
    }
  } catch (error) {
    console.warn("Zoho bulk item lookup failed, trying one by one:", error);
  }

  for (const id of itemIds.filter((id) => !result.has(id))) {
    try {
      const item = obj((await zohoGet(`items/${id}`)).item);
      const category = readCategory(item);
      if (category) result.set(id, category);
    } catch (error) {
      console.warn(`Zoho item ${id} lookup failed:`, error);
    }
  }

  return result;
}

// ------------------------------------------------------------------
// Demo bill (used until Zoho keys are added)
// ------------------------------------------------------------------

function demoBill(billNumber: string, billDate: string): Bill {
  // Mirrors a real Seven Years bill (VDK26-SI1-8504) plus a second ride-on,
  // so the multi-item flow can be tried.
  const safeNumber = billNumber.trim().toUpperCase() || "VDK26-SI1-8504";
  return {
    invoiceId: `demo-${safeNumber}`,
    billNumber: safeNumber,
    billDate,
    storeName: "Seven Years Vatakara (Edodi)",
    customer: {
      name: "",
      mobile: "",
      address: "",
    },
    lines: [
      {
        lineItemId: "demo-line-1",
        itemId: "demo-item-1",
        name: "TOTSY JEEP TE6023H",
        sku: null,
        quantity: 1,
        categoryName: "RECHARGEABLE JEEP",
      },
      {
        lineItemId: "demo-line-2",
        itemId: "demo-item-2",
        name: "BAYBEE BIKE MB170",
        sku: null,
        quantity: 2,
        categoryName: "RECHARGEABLE BIKE",
      },
      {
        lineItemId: "demo-line-3",
        itemId: "demo-item-3",
        name: "NONWOVEN CARRYBAG S",
        sku: null,
        quantity: 1,
        categoryName: "PACKING MATERIAL",
      },
    ],
    demo: true,
  };
}
