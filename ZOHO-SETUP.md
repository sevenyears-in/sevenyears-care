# Connecting Zoho POS

The app reads bills from Zoho POS (Zakya) using Zoho's API. Until this is set up, the staff
**Register Warranty** screen runs in **demo mode** and returns a sample bill for any number.

It takes about 10 minutes. You need to be able to log in to Zoho POS as an admin.

## 1. Create a "Self Client" in Zoho

1. Open **https://api-console.zoho.in** (India data centre) and log in with your Zoho POS admin account.
2. Click **Add Client** → choose **Self Client** → **Create** → **OK**.
3. Open the **Client Secret** tab. Copy the **Client ID** and **Client Secret** into `.env.local`:

   ```
   ZOHO_CLIENT_ID=1000.XXXXXXXXXXXXXXXXXXXX
   ZOHO_CLIENT_SECRET=xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
   ```

## 2. Generate a grant code

1. In the same Self Client, open the **Generate Code** tab.
2. In **Scope**, paste exactly:

   ```
   ZohoPOSAPI.invoices.READ,ZohoPOSAPI.items.READ,ZohoPOSAPI.contacts.READ,ZohoPOSAPI.settings.READ
   ```

3. **Time Duration:** 10 minutes. **Description:** Seven Years Care. Click **Create**.
4. Choose your Zoho POS organisation if asked, then copy the code it shows.

## 3. Swap the code for a refresh token (in VS Code)

Within 10 minutes, in the VS Code terminal (inside the `sevenyears-care` folder):

```bash
node scripts/zoho-token.mjs PASTE-THE-CODE-HERE
```

It prints `ZOHO_REFRESH_TOKEN=...` and your `ZOHO_ORGANIZATION_ID=...`. Add both lines to `.env.local`.

> If it says the code is invalid, it has expired or was already used. Generate a new code (step 2) and run it again.

## 4. Restart

Stop `npm run dev` (Ctrl + C) and start it again. The amber "demo mode" message on the staff
dashboard disappears.

## 5. Add your warranty categories

Log in as admin → **Categories** → add each Zoho POS category whose items carry a warranty
(e.g. *Strollers*, *Ride-Ons*, *Cradles*), with the warranty months.

Tip: fetch a real bill on **Register Warranty**. Items that aren't eligible are listed at the
bottom with the exact Zoho category name, which you can copy into Categories.

## Troubleshooting

| Message | Fix |
|---|---|
| "Could not connect to Zoho POS (invalid_client)" | Client ID/secret wrong, or the client was made on a different data centre. Use api-console.zoho.**in** for India. |
| Zoho says a scope is invalid when generating the code | Remove `ZohoPOSAPI.contacts.READ` and `ZohoPOSAPI.settings.READ` and try again. The app still works; staff may need to type the customer mobile, and you'll find the Organisation ID in Zoho POS → Settings. |
| "Bill … was not found in Zoho POS" | Check the bill number exactly as printed. |
| "Bill … exists but its date is …" | The date entered doesn't match the bill. |
| Items show "Zoho category: none" | Zoho didn't return a category for that item. Set the item's category in Zoho POS. |
| Your Zoho POS address is not app.zakya.in | Set `ZOHO_API_URL` (for example `https://api.zakya.com`) and `ZOHO_ACCOUNTS_URL` (for example `https://accounts.zoho.com`) to match your data centre. |
