// Builds a one-page A4 warranty certificate PDF (server only).
// Requires the "pdf-lib" package:  npm install pdf-lib

import { readFile } from "node:fs/promises";
import path from "node:path";
import { PDFDocument, rgb, StandardFonts, type PDFFont, type PDFPage } from "pdf-lib";
import { formatDate } from "@/lib/helpers";
import { EXTENDED_WARRANTY } from "@/lib/site-config";

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
  const regular = await pdf.embedFont(StandardFonts.Helvetica);
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);

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
    const logoBytes = await readFile(path.join(process.cwd(), "public", "seven-years-logo.png"));
    const logo = await pdf.embedPng(logoBytes);
    const logoWidth = 150;
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

  // ---------------- Footer ----------------
  const verifyUrl = `${siteUrl.replace(/\/$/, "")}/warranty/${w.verification_token}`;
  page.drawLine({ start: { x: M, y: 70 }, end: { x: width - M, y: 70 }, thickness: 1, color: LINE });
  text(page, "Verify this certificate online:", M, 54, 8, regular, GREY);
  text(page, verifyUrl, M, 42, 8, bold, TEAL);
  const issued = `Issued ${formatDate(w.created_at)}`;
  text(page, issued, width - M - regular.widthOfTextAtSize(issued, 8), 54, 8, regular, GREY);
  const footer = "Seven Years Care - Warranty & Service";
  text(page, footer, width - M - regular.widthOfTextAtSize(footer, 8), 42, 8, regular, GREY);
  page.drawRectangle({ x: 0, y: 0, width, height: 6, color: TEAL });

  return pdf.save();
}
