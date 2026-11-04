// Builds a one-page A4 warranty certificate PDF (server only).
// Requires the "pdf-lib" package:  npm install pdf-lib

import { readFile } from "node:fs/promises";
import path from "node:path";
import { PDFDocument, rgb, StandardFonts, type PDFFont, type PDFPage } from "pdf-lib";
import { embedPoppins } from "@/lib/pdf-fonts";
import { formatDate } from "@/lib/helpers";
import { EXTENDED_WARRANTY } from "@/lib/site-config";
import { qrMatrix } from "@/lib/qr";

export type CertificateData = {
  warranty_number: string;
  verification_token: string;
  bill_number: string;
  bill_date: string;
  store_name: string | null;
  product_name: string;
  sku: string | null;
  category_name: string | null;
  model_number: string;
  serial_number: string;
  customer_name: string;
  customer_mobile: string;
  customer_address: string;
  warranty_start_date: string;
  standard_warranty_expiry_date: string;
  extended_warranty_purchased: boolean;
  extended_warranty_start_date: string | null;
  extended_warranty_expiry_date: string | null;
  warranty_expiry_date: string;
  status: string;
  created_at: string;
};

export const WARRANTY_TERMS = [
  "Covers manufacturing defects under normal household use during the warranty period.",
  "Does not cover physical damage, water damage, misuse, accidents, normal wear and tear, or consumables (batteries excepted where stated).",
  "Repairs or modifications by anyone other than Seven Years authorised service void the warranty.",
  "Please show this certificate and the original bill when requesting service.",
  "The warranty is void if the serial number is removed, altered or does not match this certificate.",
];

const PINK = rgb(1, 0.369, 0.475); // #ff5e79
const TEAL = rgb(0.067, 0.722, 0.816); // #11b8d0
const DARK = rgb(0.086, 0.086, 0.086); // #161616
const GREY = rgb(0.45, 0.45, 0.45);
const LIGHT = rgb(0.969, 0.976, 0.984); // #f7f9fb
const LINE = rgb(0.9, 0.9, 0.9);
const WHITE = rgb(1, 1, 1);

/** Standard PDF fonts only support Western characters — replace anything else. */
function safe(text: string | null | undefined) {
  return (text ?? "")
    .replace(/₹/g, "Rs.")
    .replace(/[‘’]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/[–—]/g, "-")
    .replace(/[^\x20-\x7E\xA0-\xFF]/g, "?");
}

function wrap(text: string, font: PDFFont, size: number, maxWidth: number) {
  const words = safe(text).split(/\s+/).filter(Boolean);
  const lines: string[] = [];
  let current = "";

  for (const word of words) {
    const next = current ? `${current} ${word}` : word;
    if (font.widthOfTextAtSize(next, size) <= maxWidth) {
      current = next;
    } else {
      if (current) lines.push(current);
      current = word;
    }
  }
  if (current) lines.push(current);
  return lines.length ? lines : ["-"];
}

export async function buildCertificatePdf(w: CertificateData, siteUrl: string) {
  const pdf = await PDFDocument.create();
  pdf.setTitle(`Warranty Certificate ${w.warranty_number}`);
  pdf.setAuthor("Seven Years Care");
  pdf.setSubject(`${w.product_name} - Serial ${w.serial_number}`);

  const page = pdf.addPage([595.28, 841.89]); // A4
  const { width, height } = page.getSize();
  // Poppins (as on sevenyears.in); Helvetica only if the font can't be loaded.
  const poppins = await embedPoppins(pdf);
  const regular = poppins?.regular ?? (await pdf.embedFont(StandardFonts.Helvetica));
  const bold = poppins?.bold ?? (await pdf.embedFont(StandardFonts.HelveticaBold));

  const M = 40; // page margin
  const contentWidth = width - M * 2;

  const text = (
    p: PDFPage,
    value: string,
    x: number,
    y: number,
    size = 10,
    font: PDFFont = regular,
    color = DARK
  ) => p.drawText(safe(value), { x, y, size, font, color });

  // ---------------- Header ----------------
  page.drawRectangle({ x: 0, y: height - 6, width, height: 6, color: PINK });

  let logoBottom = height - 90;
  try {
    const logoBytes = await readFile(path.join(process.cwd(), "public", "seven-years-logo-2026.png"));
    const logo = await pdf.embedPng(logoBytes);
    const logoWidth = 120;
    const logoHeight = (logo.height / logo.width) * logoWidth;
    page.drawImage(logo, { x: M, y: height - 30 - logoHeight, width: logoWidth, height: logoHeight });
    logoBottom = height - 30 - logoHeight;
  } catch {
    text(page, "SEVEN YEARS", M, height - 60, 22, bold, PINK);
  }

  const title = "WARRANTY CERTIFICATE";
  text(page, title, width - M - bold.widthOfTextAtSize(title, 16), height - 50, 16, bold, DARK);
  const sub = "Seven Years Care";
  text(page, sub, width - M - regular.widthOfTextAtSize(sub, 10), height - 66, 10, regular, GREY);

  // ---------------- Warranty number band ----------------
  let y = Math.min(logoBottom, height - 80) - 20;
  const bandHeight = 70;
  page.drawRectangle({ x: M, y: y - bandHeight, width: contentWidth, height: bandHeight, color: DARK });
  text(page, "WARRANTY NUMBER", M + 18, y - 22, 8, bold, rgb(0.65, 0.65, 0.65));
  text(page, w.warranty_number, M + 18, y - 48, 20, bold, WHITE);

  const validLabel = "COVERED UNTIL";
  const validValue = formatDate(w.warranty_expiry_date);
  text(page, validLabel, width - M - 18 - bold.widthOfTextAtSize(validLabel, 8), y - 22, 8, bold, rgb(0.65, 0.65, 0.65));
  text(page, validValue, width - M - 18 - bold.widthOfTextAtSize(safe(validValue), 16), y - 46, 16, bold, TEAL);

  y -= bandHeight + 26;

  // ---------------- Two-column detail sections ----------------
  const colGap = 20;
  const colWidth = (contentWidth - colGap) / 2;

  const section = (
    x: number,
    top: number,
    heading: string,
    rows: [string, string][],
    colW = colWidth
  ) => {
    text(page, heading.toUpperCase(), x, top, 9, bold, PINK);
    page.drawLine({ start: { x, y: top - 6 }, end: { x: x + colW, y: top - 6 }, thickness: 1, color: LINE });
    let cursor = top - 22;
    for (const [label, value] of rows) {
      text(page, label, x, cursor, 8, regular, GREY);
      const lines = wrap(value || "-", bold, 10, colW);
      lines.forEach((line, i) => text(page, line, x, cursor - 13 - i * 13, 10, bold, DARK));
      cursor -= 18 + lines.length * 13;
    }
    return cursor;
  };

  const leftEnd = section(M, y, "Customer", [
    ["Name", w.customer_name],
    ["Mobile", `+91 ${w.customer_mobile}`],
    ["Address", w.customer_address],
  ]);

  const rightEnd = section(M + colWidth + colGap, y, "Product", [
    ["Product", w.product_name],
    ["Category", w.category_name ?? "-"],
    ["Model Number", w.model_number],
    ["Serial Number", w.serial_number],
  ]);

  y = Math.min(leftEnd, rightEnd) - 8;

  const leftEnd2 = section(M, y, "Purchase", [
    ["Bill Number", w.bill_number],
    ["Bill Date", formatDate(w.bill_date)],
    ["Purchased From", w.store_name ?? "Seven Years"],
  ]);

  const coverageRows: [string, string][] = [
    [
      "Standard Warranty",
      `${formatDate(w.warranty_start_date)} to ${formatDate(w.standard_warranty_expiry_date)}`,
    ],
    [
      "Extended Warranty",
      w.extended_warranty_purchased
        ? `${formatDate(w.extended_warranty_start_date)} to ${formatDate(w.extended_warranty_expiry_date)} (${safe(EXTENDED_WARRANTY.feeLabel)})`
        : "Not purchased",
    ],
    ["Status", w.status === "active" ? "Active" : "Void"],
  ];
  const rightEnd2 = section(M + colWidth + colGap, y, "Coverage", coverageRows);

  y = Math.min(leftEnd2, rightEnd2) - 8;

  // ---------------- Terms ----------------
  const termsTop = y;
  const termLines = WARRANTY_TERMS.map((t) => wrap(t, regular, 8.5, contentWidth - 34));
  const termsHeight = 30 + termLines.reduce((sum, l) => sum + l.length * 11 + 4, 0);

  page.drawRectangle({ x: M, y: termsTop - termsHeight, width: contentWidth, height: termsHeight, color: LIGHT });
  text(page, "WARRANTY TERMS", M + 14, termsTop - 18, 8, bold, GREY);

  let ty = termsTop - 34;
  termLines.forEach((lines, index) => {
    text(page, `${index + 1}.`, M + 14, ty, 8.5, bold, GREY);
    lines.forEach((line, i) => text(page, line, M + 28, ty - i * 11, 8.5, regular, DARK));
    ty -= lines.length * 11 + 4;
  });

  // ---------------- Footer (with QR code to verify online) ----------------
  const verifyUrl = `${siteUrl.replace(/\/$/, "")}/warranty/${w.verification_token}`;
  const qrSize = 84;
  const qrX = width - M - qrSize;
  const qrY = 12;
  try {
    const matrix = qrMatrix(verifyUrl);
    const cell = qrSize / matrix.length;
    page.drawRectangle({ x: qrX - 3, y: qrY - 3, width: qrSize + 6, height: qrSize + 6, color: WHITE });
    matrix.forEach((row, r) =>
      row.forEach((dark, c) => {
        if (dark) {
          page.drawRectangle({
            x: qrX + c * cell,
            y: qrY + qrSize - (r + 1) * cell,
            width: cell + 0.05,
            height: cell + 0.05,
            color: DARK,
          });
        }
      })
    );
  } catch (error) {
    console.warn("QR code skipped:", error);
  }

  const rightEdge = qrX - 12;
  page.drawLine({ start: { x: M, y: 104 }, end: { x: width - M, y: 104 }, thickness: 1, color: LINE });
  text(page, "Scan the QR code or open this link to verify:", M, 82, 8, regular, GREY);
  text(page, verifyUrl, M, 68, 8, bold, TEAL);
  text(page, `Issued ${formatDate(w.created_at)}  -  Seven Years Care - Warranty & Service`, M, 50, 8, regular, GREY);
  const accountLine = `My account: ${siteUrl.replace(/\/$/, "")}/account  |  User ID: your mobile number  |  First password: last 4 digits of your bill number`;
  wrap(accountLine, regular, 7, rightEdge - M).forEach((line, i) => text(page, line, M, 34 - i * 9, 7, regular, GREY));
  page.drawRectangle({ x: 0, y: 0, width, height: 6, color: TEAL });

  return pdf.save();
}
