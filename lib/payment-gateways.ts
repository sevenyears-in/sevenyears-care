// Paytm and ICICI Eazypay (server only). Razorpay lives in lib/extended-warranty.ts.
// Both send the customer to the bank's own payment page and back to us; we only
// mark a payment as received after checking the bank's signature (and, for Paytm,
// asking Paytm for the final status).

import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";
import type { ExtendedSettings } from "@/lib/extended-warranty";

// ------------------------------------------------------------------
// Paytm (Payment Gateway "JS/Redirect" flow with checksum — same algorithm as PaytmChecksum.js)
// ------------------------------------------------------------------

const PAYTM_IV = "@@@@&&&&####$$$$";

function paytmHost(s: ExtendedSettings) {
  return s.paytmStaging ? "https://securegw-stage.paytm.in" : "https://securegw.paytm.in";
}

function paytmAes(key: string) {
  const k = Buffer.from(key, "utf8");
  return k.length === 32 ? "aes-256-cbc" : k.length === 24 ? "aes-192-cbc" : "aes-128-cbc";
}

function paytmEncrypt(text: string, key: string) {
  const cipher = createCipheriv(paytmAes(key), Buffer.from(key, "utf8"), Buffer.from(PAYTM_IV, "utf8"));
  return Buffer.concat([cipher.update(text, "utf8"), cipher.final()]).toString("base64");
}

function paytmDecrypt(text: string, key: string) {
  try {
    const decipher = createDecipheriv(paytmAes(key), Buffer.from(key, "utf8"), Buffer.from(PAYTM_IV, "utf8"));
    return Buffer.concat([decipher.update(Buffer.from(text, "base64")), decipher.final()]).toString("utf8");
  } catch {
    return "";
  }
}

function paytmHash(params: string, salt: string) {
  return createHash("sha256").update(`${params}|${salt}`).digest("hex") + salt;
}

export function paytmSign(params: string, key: string) {
  const salt = randomBytes(3).toString("base64"); // 4 characters
  return paytmEncrypt(paytmHash(params, salt), key);
}

/** Paytm's way of turning callback fields into the signed string. */
function paytmStringByParams(fields: Record<string, string>) {
  return Object.keys(fields)
    .sort()
    .map((k) => {
      const v = fields[k];
      return v !== null && v !== undefined && String(v).toLowerCase() !== "null" ? String(v) : "";
    })
    .join("|");
}

export function paytmVerify(fields: Record<string, string>, key: string, checksum: string) {
  const copy = { ...fields };
  delete copy.CHECKSUMHASH;
  const decrypted = paytmDecrypt(checksum, key);
  if (decrypted.length < 5) return false;
  const salt = decrypted.slice(-4);
  return decrypted === paytmHash(paytmStringByParams(copy), salt);
}

export async function paytmInitiate(
  s: ExtendedSettings,
  input: { orderId: string; amount: number; customerId: string; mobile: string; callbackUrl: string }
) {
  const body = {
    requestType: "Payment",
    mid: s.paytmMid,
    websiteName: s.paytmWebsite || "DEFAULT",
    orderId: input.orderId,
    callbackUrl: input.callbackUrl,
    txnAmount: { value: input.amount.toFixed(2), currency: "INR" },
    userInfo: { custId: input.customerId, mobile: input.mobile },
  };
  const signature = paytmSign(JSON.stringify(body), s.paytmKey);
  const url = `${paytmHost(s)}/theia/api/v1/initiateTransaction?mid=${encodeURIComponent(s.paytmMid)}&orderId=${encodeURIComponent(input.orderId)}`;
  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ body, head: { signature } }),
    signal: AbortSignal.timeout(15_000),
  });
  const data = (await response.json().catch(() => ({}))) as {
    body?: { txnToken?: string; resultInfo?: { resultStatus?: string; resultMsg?: string } };
  };
  const token = data.body?.txnToken;
  if (!response.ok || !token || data.body?.resultInfo?.resultStatus !== "S") {
    console.error("Paytm initiate error:", response.status, data.body?.resultInfo);
    throw new Error(data.body?.resultInfo?.resultMsg || "Could not start the Paytm payment.");
  }
  return {
    action: `${paytmHost(s)}/theia/api/v1/showPaymentPage?mid=${encodeURIComponent(s.paytmMid)}&orderId=${encodeURIComponent(input.orderId)}`,
    fields: { mid: s.paytmMid, orderId: input.orderId, txnToken: token },
  };
}

/** Ask Paytm for the final status of an order (never trust the browser alone). */
export async function paytmStatus(s: ExtendedSettings, orderId: string) {
  const body = { mid: s.paytmMid, orderId };
  const signature = paytmSign(JSON.stringify(body), s.paytmKey);
  const response = await fetch(`${paytmHost(s)}/v3/order/status`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ body, head: { signature } }),
    signal: AbortSignal.timeout(15_000),
  });
  const data = (await response.json().catch(() => ({}))) as {
    body?: { resultInfo?: { resultStatus?: string }; txnAmount?: string; txnId?: string };
  };
  return {
    success: data.body?.resultInfo?.resultStatus === "TXN_SUCCESS",
    amount: Number(data.body?.txnAmount ?? 0),
    txnId: data.body?.txnId ?? null,
  };
}

// ------------------------------------------------------------------
// ICICI Bank Eazypay (redirect with AES-128-ECB encrypted fields; reply signed with SHA-512)
// ------------------------------------------------------------------

function iciciEncrypt(text: string, key: string) {
  const cipher = createCipheriv("aes-128-ecb", Buffer.from(key.slice(0, 16), "utf8"), null);
  return Buffer.concat([cipher.update(text, "utf8"), cipher.final()]).toString("base64");
}

export function iciciPaymentUrl(s: ExtendedSettings, input: { referenceNo: string; amount: number; returnUrl: string }) {
  const amount = input.amount.toFixed(2);
  const enc = (v: string) => encodeURIComponent(iciciEncrypt(v, s.iciciAesKey));
  const params = [
    `merchantid=${encodeURIComponent(s.iciciMerchantId)}`,
    `mandatory%20fields=${enc(`${input.referenceNo}|${s.iciciSubMerchantId}|${amount}`)}`,
    `optional%20fields=`,
    `returnurl=${enc(input.returnUrl)}`,
    `Reference%20No=${enc(input.referenceNo)}`,
    `submerchantid=${enc(s.iciciSubMerchantId)}`,
    `transaction%20amount=${enc(amount)}`,
    `paymode=${enc(s.iciciPaymode || "9")}`,
  ];
  return `https://eazypay.icicibank.com/EazyPG?${params.join("&")}`;
}

/** Check the "RS" signature on Eazypay's reply. */
export function iciciVerify(fields: Record<string, string>, key: string) {
  const order = [
    "ID",
    "Response Code",
    "Unique Ref Number",
    "Service Tax Amount",
    "Processing Fee Amount",
    "Total Amount",
    "Transaction Amount",
    "Transaction Date",
    "Interchange Value",
    "TDR",
    "Payment Mode",
    "SubMerchantId",
    "ReferenceNo",
    "TPS",
  ];
  const text = [...order.map((k) => fields[k] ?? ""), key].join("|");
  const expected = createHash("sha512").update(text).digest("hex");
  return Boolean(fields.RS) && expected.toLowerCase() === String(fields.RS).toLowerCase();
}
