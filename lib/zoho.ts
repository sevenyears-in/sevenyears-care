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
  /** Staff who made the sale (Zoho salesperson), when Zoho has one. */
  salespersonName: string | null;
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
  "ZohoPOSAPI.invoices.READ,ZohoPOSAPI.items.READ,ZohoPOSAPI.contacts.READ,ZohoPOSAPI.settings.READ,ZohoPOSAPI.creditnotes.READ";

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
  await supabaseAdmin.from("app_settings").upsert({ key: TOKEN_KEY, value: {}, updated_at: new Date().toISOString() });
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
let tokenInFlight: Promise<string> | null = null;
let badToken = "";
let tokenBlockedUntil = 0;
const TOKEN_KEY = "zoho_token";

// Zoho allows only a few sign-ins (new access tokens) in a short time, so:
// one sign-in at a time, and the token is kept in the database for every server process.
async function accessToken() {
  if (cachedToken && cachedToken.expiresAt > Date.now()) return cachedToken.value;
  if (!tokenInFlight) tokenInFlight = fetchToken().finally(() => (tokenInFlight = null));
  return tokenInFlight;
}

async function fetchToken(): Promise<string> {
  try {
    const { data } = await supabaseAdmin.from("app_settings").select("value").eq("key", TOKEN_KEY).maybeSingle();
    const saved = (data?.value ?? {}) as { value?: string; expiresAt?: number };
    if (saved.value && saved.value !== badToken && (saved.expiresAt ?? 0) > Date.now() + 60_000) {
      cachedToken = { value: saved.value, expiresAt: saved.expiresAt as number };
      return saved.value;
    }
  } catch {
    /* fall through to a new sign-in */
  }
  if (Date.now() < tokenBlockedUntil) {
    throw new ZohoError("Zoho POS is busy right now (too many sign-ins). Please try again in a few minutes.");
  }

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
    signal: AbortSignal.timeout(10_000),
  }).catch(() => {
    throw new ZohoError("Could not reach Zoho POS (sign-in). Please try again.");
  });

  const data = (await response.json().catch(() => ({}))) as {
    access_token?: string;
    expires_in?: number;
    error?: string;
    error_description?: string;
  };

  if (!response.ok || !data.access_token) {
    console.error("Zoho token error:", response.status, data);
    if (/access denied|too many/i.test(`${data.error ?? ""} ${data.error_description ?? ""}`)) {
      tokenBlockedUntil = Date.now() + 3 * 60_000;
      throw new ZohoError("Zoho POS is busy right now (too many sign-ins). Please try again in a few minutes.");
    }
    throw new ZohoError(
      `Could not connect to Zoho POS (${data.error ?? response.status}). Check the Zoho connection.`
    );
  }

  cachedToken = {
    value: data.access_token,
    expiresAt: Date.now() + Math.max(60, (data.expires_in ?? 3600) - 300) * 1000,
  };
  await supabaseAdmin
    .from("app_settings")
    .upsert({ key: TOKEN_KEY, value: cachedToken, updated_at: new Date().toISOString() })
    .then(
      () => undefined,
      () => undefined
    );
  return cachedToken.value;
}

type ZohoJson = { code?: number; message?: string; [key: string]: unknown };

async function zohoGet(path: string, query: Record<string, string> = {}): Promise<ZohoJson> {
  const config = await zohoConfig();
  const url = new URL(`${config.apiUrl}/inventory/v1/${path}`);
  url.searchParams.set("organization_id", config.organizationId);
  for (const [key, value] of Object.entries(query)) url.searchParams.set(key, value);

  // Never let a slow Zoho POS hold a page for long.
  const response = await fetch(url, {
    headers: { Authorization: `Zoho-oauthtoken ${await accessToken()}` },
    cache: "no-store",
    signal: AbortSignal.timeout(12_000),
  }).catch((error) => {
    throw new ZohoError(
      error instanceof Error && error.name === "TimeoutError"
        ? "Zoho POS is taking too long to answer. Please try again."
        : "Could not reach Zoho POS. Please try again."
    );
  });

  const data = (await response.json().catch(() => ({}))) as ZohoJson;

  // Only a dead token needs a new sign-in. "Not authorized" (a permission the connection
  // does not have, e.g. credit notes) also comes as 401 but must NOT cause a new sign-in.
  if (response.status === 401 && (data.code === 14 || /oauth|token/i.test(String(data.message ?? "")))) {
    badToken = cachedToken?.value ?? badToken;
    cachedToken = null;
  }

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

  return billFromInvoice(match);
}

/** Full bill (lines, categories, customer) for one invoice from the Zoho list. */
async function billFromInvoice(match: Obj, categoryCache?: Map<string, string>): Promise<Bill> {
  const detail = obj((await zohoGet(`invoices/${str(match.invoice_id)}`)).invoice);
  const lineItems = arr(detail.line_items);

  // Item categories are not on the bill lines, so look the items up.
  const itemIds = [...new Set(lineItems.map((l) => str(l.item_id)).filter(Boolean))];
  const categories = await fetchItemCategories(itemIds, categoryCache);

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
    salespersonName: str(detail.salesperson_name) || str(match.salesperson_name) || null,
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

export type InvoiceSummary = {
  billNumber: string;
  billDate: string;
  storeName: string | null;
  salespersonName: string | null;
  customerName: string;
};

/** Look up a bill by its number only (no date). Null if Zoho doesn't have it. */
export async function fetchInvoiceByNumber(billNumber: string): Promise<InvoiceSummary | null> {
  if (!(await zohoConfigured())) return null;
  const wanted = billNumber.trim().toUpperCase();
  const list = await zohoGet("invoices", { invoice_number: billNumber.trim() });
  const matches = arr(list.invoices)
    .filter((inv) => str(inv.invoice_number).toUpperCase() === wanted)
    .sort((a, b) => str(b.date).localeCompare(str(a.date)));
  const match = matches[0];
  if (!match) return null;

  let salesperson = str(match.salesperson_name);
  let storeName = str(match.location_name) || str(match.branch_name) || "";
  if (!salesperson || !storeName) {
    try {
      const detail = obj((await zohoGet(`invoices/${str(match.invoice_id)}`)).invoice);
      salesperson = salesperson || str(detail.salesperson_name);
      storeName = storeName || str(detail.location_name) || str(detail.branch_name) || str(detail.warehouse_name);
    } catch (error) {
      console.warn("Zoho invoice detail failed (continuing):", error);
    }
  }

  return {
    billNumber: str(match.invoice_number),
    billDate: str(match.date),
    storeName: storeName || null,
    salespersonName: salesperson || null,
    customerName: str(match.customer_name),
  };
}

async function fetchItemCategories(allIds: string[], cache?: Map<string, string>) {
  const result = new Map<string, string>();
  if (cache) for (const id of allIds) if (cache.has(id)) result.set(id, cache.get(id)!);
  const itemIds = allIds.filter((id) => !result.has(id));
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

  if (cache) for (const id of itemIds) cache.set(id, result.get(id) ?? "");
  return result;
}

// ------------------------------------------------------------------
// Stores (Zoho POS locations / branches)
// ------------------------------------------------------------------

export type ZohoStore = {
  id: string;
  name: string;
  /** Branch / location code from Zoho, when Zoho has one. */
  code: string | null;
  active: boolean;
};

function readStore(item: Obj, idKey: string, nameKey: string): ZohoStore | null {
  const name = str(item[nameKey]);
  if (!name) return null;
  const status = str(item.status).toLowerCase();
  return {
    id: str(item[idKey]) || name,
    name,
    code:
      str(item.location_code) ||
      str(item.branch_code) ||
      str(item.warehouse_code) ||
      str(item.code) ||
      null,
    active: !status || status === "active",
  };
}

/**
 * All stores set up in Zoho POS. Tries Locations first, then Branches, then
 * Warehouses (different Zoho set-ups use different names for the same thing).
 */
export async function fetchZohoStores(): Promise<ZohoStore[]> {
  const attempts: { path: string; listKey: string; idKey: string; nameKey: string }[] = [
    { path: "locations", listKey: "locations", idKey: "location_id", nameKey: "location_name" },
    { path: "branches", listKey: "branches", idKey: "branch_id", nameKey: "branch_name" },
    { path: "settings/warehouses", listKey: "warehouses", idKey: "warehouse_id", nameKey: "warehouse_name" },
  ];

  const errors: string[] = [];
  for (const a of attempts) {
    try {
      const data = await zohoGet(a.path);
      const stores = arr(data[a.listKey])
        .flatMap((item) => [item, ...arr(item.child_locations)])
        .map((item) => readStore(item, a.idKey, a.nameKey))
        .filter((s): s is ZohoStore => Boolean(s));
      if (stores.length > 0) {
        const unique = new Map(stores.map((s) => [s.name.toLowerCase(), s]));
        return [...unique.values()].sort((x, y) => x.name.localeCompare(y.name));
      }
      errors.push(`${a.path}: empty`);
    } catch (error) {
      errors.push(`${a.path}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  // Fallback: collect the store names printed on recent bills (needs only invoice access).
  try {
    const stores = await storesFromRecentInvoices();
    if (stores.length > 0) return stores;
    errors.push("recent bills: no store names found");
  } catch (error) {
    errors.push(`recent bills: ${error instanceof Error ? error.message : String(error)}`);
  }

  throw new ZohoError(`Could not read the store list from Zoho POS (${errors.join("; ")}).`);
}

/** Stores that billed in the last 120 days (a new store appears after its first bill). */
async function storesFromRecentInvoices(): Promise<ZohoStore[]> {
  const from = new Date(Date.now() - 120 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
  const found = new Map<string, ZohoStore>();

  for (let page = 1; page <= 10; page++) {
    const data = await zohoGet("invoices", {
      date_start: from,
      per_page: "200",
      page: String(page),
      sort_column: "date",
      sort_order: "D",
    });
    for (const inv of arr(data.invoices)) {
      const name = str(inv.location_name) || str(inv.branch_name) || str(inv.warehouse_name);
      if (!name || found.has(name.toLowerCase())) continue;
      found.set(name.toLowerCase(), {
        id: str(inv.location_id) || str(inv.branch_id) || name,
        name,
        code: null,
        active: true,
      });
    }
    const more = obj(data.page_context).has_more_page;
    if (!more) break;
  }

  return [...found.values()].sort((x, y) => x.name.localeCompare(y.name));
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
    salespersonName: null,
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

/**
 * Bills in Zoho for a customer's mobile number (for customers who bought from us but have
 * no warranty registered). Finds the Zoho contact(s) with that number, then their invoices.
 */
export async function fetchInvoicesForMobile(mobile: string): Promise<{ billNumber: string; customerName: string; billDate: string }[]> {
  if (!(await zohoConfigured())) return [];
  const digits = (v: unknown) => str(v).replace(/\D/g, "");
  const sameNumber = (c: Obj) => [c.phone, c.mobile].some((v) => digits(v).endsWith(mobile));

  const contacts = new Map<string, Obj>();
  const queries: Record<string, string>[] = [{ phone_contains: mobile }, { mobile_contains: mobile }, { search_text: mobile }];
  for (const query of queries) {
    try {
      const list = await zohoGet("contacts", { ...query, per_page: "25" });
      for (const c of arr(list.contacts)) if (sameNumber(c)) contacts.set(str(c.contact_id), c);
    } catch (error) {
      console.warn("Zoho contact search failed (continuing):", error);
    }
    if (contacts.size) break;
  }

  const bills: { billNumber: string; customerName: string; billDate: string }[] = [];
  for (const [id, c] of [...contacts].slice(0, 5)) {
    try {
      const list = await zohoGet("invoices", { customer_id: id, per_page: "200" });
      for (const inv of arr(list.invoices)) {
        if (str(inv.status) === "void") continue;
        bills.push({ billNumber: str(inv.invoice_number), customerName: str(inv.customer_name) || str(c.contact_name), billDate: str(inv.date) });
      }
    } catch (error) {
      console.warn("Zoho invoice list failed (continuing):", error);
    }
  }
  return bills;
}

// ------------------------------------------------------------------
// Sales performance sync (lib/sales-sync.ts uses these)
// ------------------------------------------------------------------

/** Raw GET for the sales sync (server only). */
export async function zohoRead(path: string, query: Record<string, string> = {}) {
  return zohoGet(path, query);
}
