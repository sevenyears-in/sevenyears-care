# Alerts setup — e-mail, WhatsApp and automatic escalation

Dashboard alerts (the 🔔 on the staff screens) work with no setup.
E-mail and WhatsApp need the settings below.

**Where to put the settings:** log in as Super Admin → **Alerts Setup**, fill in
the form and press **Save settings**, then **Test e-mail** / **Test WhatsApp**.
Only the Super Admin can see or change this page. Passwords and tokens are kept
on the server and are never shown again (leave the box blank to keep them).

(The environment-variable names below still work as a fallback for anything
left blank on that page.)

---

## 1. E-mail (any mailbox — Hostinger e-mail works)

```
SMTP_HOST=smtp.hostinger.com
SMTP_PORT=465
SMTP_USER=care@sevenyears.in
SMTP_PASS=the-mailbox-password
MAIL_FROM=care@sevenyears.in
```

Create the mailbox first (hPanel → Emails → Create e-mail account).
For Gmail use `smtp.gmail.com`, port `465`, and a Google "App password" (not your normal password).

## 2. WhatsApp (Meta WhatsApp Cloud API)

WhatsApp only lets businesses send messages that start a conversation using
**approved templates**. One-time setup (about a day, mostly waiting for Meta):

1. Go to business.facebook.com → create/verify the **Seven Years** business.
2. Go to developers.facebook.com → **Create app** → type **Business** → add **WhatsApp**.
3. In WhatsApp → **API Setup**: add a phone number for Seven Years Care
   (a number that is NOT already used in the normal WhatsApp app) and verify it.
4. Create a **permanent access token**: Business Settings → Users → System users →
   Add (Admin) → **Generate token** → choose the app → tick
   `whatsapp_business_messaging` and `whatsapp_business_management` → copy the token.
5. WhatsApp Manager → **Message templates** → create these two templates,
   category **Utility**, language **English**:

   **Name: `staff_ticket_alert`**
   ```
   🔔 {{1}}
   {{2}}
   Store: {{3}}
   Open: {{4}}
   ```
   Sample values: `New service request SY-SRV-2026-123456` · `Stroller — Wheel, brake or frame issue · Customer: Anu (9876543210)` · `Seven Years Vatakara` · `https://care.sevenyears.in/staff/service/abc`

   **Name: `customer_ticket_update`**
   ```
   Hi {{1}}, update on your Seven Years request {{2}}:
   {{3}}
   Track it here: {{4}}
   ```
   Sample values: `Anu` · `SY-SRV-2026-123456` · `A technician has been assigned to your request.` · `https://care.sevenyears.in/track-request?ticket=SY-SRV-2026-123456`

6. When both templates show **Approved**, add:

```
WHATSAPP_TOKEN=the-permanent-token
WHATSAPP_PHONE_NUMBER_ID=the-Phone-number-ID-from-API-Setup
WHATSAPP_STAFF_TEMPLATE=staff_ticket_alert
WHATSAPP_CUSTOMER_TEMPLATE=customer_ticket_update
WHATSAPP_TEMPLATE_LANGUAGE=en
```

(If Meta gives the language as `en_US`, use that instead of `en`.)

## 3. Automatic escalation (every 30 minutes)

Alerts Setup creates a private escalation address when you press **Save
settings** (press **Copy** to copy it). Set a job that opens it every 30 minutes:

- Hostinger: hPanel → Advanced → **Cron Jobs** → Custom command:
  `curl -s "PASTE-THE-ADDRESS-HERE"` → every 30 minutes.
- Or use a free service such as cron-job.org with the same address.

Escalation rules (from the SOPs):

| Level | When | Who is alerted |
|---|---|---|
| 1 | Not acknowledged in 2 hours, or resolution deadline missed | Store Manager (+ Service Head for service; + Operations Manager for complaints) |
| 2 | Still open 24 hours after the deadline | Operations Manager (+ Service Head / HR Head) |
| 3 | Still open 48 hours after the deadline | Super Admin |

## Staff contact details

Each person gets alerts only if their **e-mail** and/or **WhatsApp number** is
filled in at Staff → Staff Users (tick boxes turn each channel on/off).
Store names come from Zoho POS (Staff Users shows a drop-down of the Zoho
stores plus CORPORATE OFFICE), so they always match the bills and the
complaint form.
