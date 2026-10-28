# Seven Years Care

Warranty and service portal for Seven Years (Next.js 16 + Supabase + Zoho POS).

## Staff side (login required): `/staff`

| Screen | What it does |
|---|---|
| Staff Login `/staff/login` | User ID + password |
| First-time setup `/staff/setup` | Creates the first administrator (only works while there are no staff users) |
| Register Warranty `/staff/register` | Enter bill number + date → bill is fetched from Zoho POS → each warranty-eligible item appears as its own row (qty 2 = 2 rows) → staff fill model no., serial no., customer name, mobile, address (+ optional extended warranty) → **Save** → **Generate Warranty Cards** downloads one PDF certificate per item |
| Warranties `/staff/warranties` | Search by bill / warranty / mobile / serial, re-download PDFs |
| Categories `/staff/admin/categories` (admin) | Which Zoho POS categories are warranty-eligible, and for how many months |
| Staff Users `/staff/admin/users` (admin) | Add staff with role + store, e-mail / WhatsApp for alerts, reset passwords, disable accounts |
| Service Requests `/staff/service` | Queue for Store Manager, Service Head, Technicians — acknowledge, classify, assign, resolve |
| Complaints `/staff/complaints` | Queue for Store Manager, HR Head, Operations Manager |
| Alerts `/staff/alerts` | The 🔔 — new requests, assignments, approvals, escalations |
| Alerts Setup `/staff/admin/notifications` (Super Admin) | E-mail / WhatsApp / escalation status, test messages, delivery log |
| Zoho POS `/staff/admin/zoho` (Super Admin only) | Connect / disconnect Zoho POS |

## Roles

| Role | Sees | Does |
|---|---|---|
| Super Admin (SHAJEER ALI NV) | Everything | Everything, incl. Zoho POS connection and admin accounts |
| Admin | Everything | Categories, staff users (not admin accounts, not Zoho) |
| Store Manager | Service requests + complaints of their store | Acknowledge, classify, assign technicians of their store, resolve, close |
| Service Head | All service requests | Assign any technician, approve replacements, cancel |
| Technician | Service requests of their store + jobs assigned to them | Acknowledge, start, parts, ask for replacement approval, resolve |
| HR Head | All complaints | Leads staff-behaviour complaints |
| Operations Manager | All complaints | Escalation level 2 |
| Store Staff | — | Register warranties |

## Process flow

**Service request** (Toys Service SOP): Received → **Acknowledge** (2 hrs) → Classify
(minor 2 days / moderate 3 / major 7 / installation 1; safety issues 24 hrs) → **Assign technician** →
Start → (Waiting for parts / Replacement approval by Service Head) → **Resolve** (customer is told what was done) →
**Close** after customer confirms. Reopen if the customer isn't happy.

**Complaint** (Complaint Management SOP): Received → **Acknowledge** (2 hrs) → Classify → **Assign owner** →
Investigate → **Resolve** → **Close** after customer confirms.

Every step is on the timeline. "Customer sees" steps show on Track Request and go to the customer on
WhatsApp; "Staff only" notes never do. Alerts: dashboard + e-mail + WhatsApp — see NOTIFICATIONS-SETUP.md.

## Customer side (public)

| Page | What it does |
|---|---|
| `/my-warranties` | Mobile number + a warranty or bill number → all their warranties and certificates |
| `/warranty/<token>` | Online certificate + PDF download |
| `/request-service` | Service request against a warranty; optional current location |
| `/register-complaint` | Complaint (no warranty needed) |
| `/track-request` | Status and timeline of a service request or complaint |

## Setup

1. **Install packages** (adds `pdf-lib` for the PDF certificates):

   ```bash
   npm install
   ```

2. **Database:** in Supabase → **SQL Editor** → New query → paste `supabase/setup.sql` → **Run**.
   Then a new query with `supabase/workflow-upgrade.sql` → **Run** (roles, workflow, alerts).

3. **`.env.local`** — add these lines (keep the Supabase ones you already have):

   ```
   # Supabase (already there)
   NEXT_PUBLIC_SUPABASE_URL=...
   NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=...
   SUPABASE_SECRET_KEY=...

   # Staff login — any random text of 32+ characters. Generate one with:
   #   node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
   STAFF_SESSION_SECRET=

   # Zoho POS — see ZOHO-SETUP.md (leave empty for demo mode)
   ZOHO_CLIENT_ID=
   ZOHO_CLIENT_SECRET=
   ZOHO_REFRESH_TOKEN=
   ZOHO_ORGANIZATION_ID=

   # Optional
   NEXT_PUBLIC_WHATSAPP_NUMBER=91XXXXXXXXXX
   NEXT_PUBLIC_SITE_URL=https://your-live-address   # printed on PDF certificates
   ```

4. **Run:** `npm run dev`, open http://localhost:3000/staff/setup and create the admin account.

5. **Add warranty categories** (Staff → Categories), then add staff users.

## Alerts (e-mail, WhatsApp, escalation)

See **NOTIFICATIONS-SETUP.md**.

## Code map

```
app/staff/login, app/staff/setup           Login + first admin
app/staff/(portal)/...                      Staff pages (protected by layout.tsx)
app/api/staff/...                           Staff APIs (login, logout, setup, bill-lookup, warranties, admin/*)
app/api/certificate/[token]/pdf             PDF certificate
lib/auth.ts                                 Password hashing + signed session cookie
lib/zoho.ts                                 Zoho POS client (+ demo mode)
lib/warranty-rules.ts                       Bill → eligible rows (one per unit)
lib/certificate-pdf.ts                      PDF layout + warranty terms
supabase/setup.sql                          All tables
scripts/zoho-token.mjs                      Zoho refresh-token helper
```
