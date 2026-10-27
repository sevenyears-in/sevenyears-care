// Helper: turns a Zoho "grant code" into a refresh token and lists your
// Zoho POS organisations. See ZOHO-SETUP.md.
//
// Usage (in the VS Code terminal, from the project folder):
//   node scripts/zoho-token.mjs <grant-code>
//
// Reads ZOHO_CLIENT_ID and ZOHO_CLIENT_SECRET (and optionally
// ZOHO_ACCOUNTS_URL / ZOHO_API_URL) from .env.local.

import { readFileSync } from "node:fs";

function loadEnv() {
  const env = {};
  try {
    for (const line of readFileSync(".env.local", "utf8").split(/\r?\n/)) {
      const match = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
      if (match) env[match[1]] = match[2].replace(/^["']|["']$/g, "");
    }
  } catch {
    console.error("Could not read .env.local — run this from the project folder.");
    process.exit(1);
  }
  return env;
}

const code = process.argv[2];
if (!code) {
  console.error("Usage: node scripts/zoho-token.mjs <grant-code>");
  process.exit(1);
}

const env = loadEnv();
const accounts = (env.ZOHO_ACCOUNTS_URL || "https://accounts.zoho.in").replace(/\/$/, "");
const api = (env.ZOHO_API_URL || "https://api.zakya.in").replace(/\/$/, "");

if (!env.ZOHO_CLIENT_ID || !env.ZOHO_CLIENT_SECRET) {
  console.error("Add ZOHO_CLIENT_ID and ZOHO_CLIENT_SECRET to .env.local first.");
  process.exit(1);
}

const tokenResponse = await fetch(`${accounts}/oauth/v2/token`, {
  method: "POST",
  headers: { "Content-Type": "application/x-www-form-urlencoded" },
  body: new URLSearchParams({
    code,
    client_id: env.ZOHO_CLIENT_ID,
    client_secret: env.ZOHO_CLIENT_SECRET,
    grant_type: "authorization_code",
  }),
});
const token = await tokenResponse.json();

if (!token.refresh_token) {
  console.error("\nZoho did not return a refresh token:", token);
  console.error(
    "\nThe grant code is valid for only a few minutes and works once. Generate a new one and try again."
  );
  process.exit(1);
}

console.log("\n✔ Add this line to .env.local:\n");
console.log(`ZOHO_REFRESH_TOKEN=${token.refresh_token}\n`);

const orgResponse = await fetch(`${api}/inventory/v1/organizations`, {
  headers: { Authorization: `Zoho-oauthtoken ${token.access_token}` },
});
const orgs = await orgResponse.json().catch(() => ({}));

if (Array.isArray(orgs.organizations) && orgs.organizations.length > 0) {
  console.log("Your Zoho POS organisations — add the right one to .env.local:\n");
  for (const org of orgs.organizations) {
    console.log(`ZOHO_ORGANIZATION_ID=${org.organization_id}    # ${org.name}`);
  }
} else {
  console.log(
    "Couldn't list organisations automatically. Find the Organisation ID in Zoho POS → Settings → Organisation Profile."
  );
  console.log(orgs);
}
console.log("\nThen restart `npm run dev`.");
