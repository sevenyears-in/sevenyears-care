// Warning letter PDF on the Seven Years letterhead (public/letterhead.jpg). Server only.
// Page size follows the letterhead (612 × 797 pt); the text sits between the logo at the top
// and the purple line at the bottom, and runs onto more pages if needed.

import { readFile } from "node:fs/promises";
import path from "node:path";
import { PDFDocument, rgb, StandardFonts, type PDFFont, type PDFImage, type PDFPage } from "pdf-lib";
import { embedPoppins } from "@/lib/pdf-fonts";
import { formatDate } from "@/lib/helpers";

export type LetterPdfData = {
  number: string | null;
  sentAt: string | null;
  createdAt: string;
  staffName: string;
  userId: string;
  designation: string | null;
  store: string | null;
  subject: string;
  body: string;
  issuedByName: string | null;
  issuedByRole: string | null;
  ackAt: string | null;
  ackNote: string | null;
};

const W = 612;
const H = 797;
const LEFT = 60;
const RIGHT = W - 60;
const TOP = H - 135; // below the logo
const BOTTOM = 92; // above the purple line
const DARK = rgb(0.086, 0.086, 0.086);
const GREY = rgb(0.42, 0.42, 0.42);
const PINK = rgb(0.937, 0.373, 0.475);

/** Fonts without Indian scripts: replace what they cannot draw. */
function safe(text: string, font: PDFFont) {
  const t = (text ?? "")
    .replace(/₹/g, "Rs.")
    .replace(/[‘’]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/[–—]/g, "-")
    .replace(/•/g, "-")
    .replace(/\t/g, "  ")
    .replace(/\r/g, "");
  let out = "";
  for (const ch of t) {
    if (ch === "\n") {
      out += ch;
      continue;
    }
    try {
      font.encodeText(ch);
      out += ch;
    } catch {
      out += "?";
    }
  }
  return out;
}

function wrap(text: string, font: PDFFont, size: number, maxWidth: number): string[] {
  const lines: string[] = [];
  for (const para of text.split("\n")) {
    if (!para.trim()) {
      lines.push("");
      continue;
    }
    const indent = /^\s*[-•]\s/.test(para) ? "    " : "";
    let line = "";
    for (const word of para.split(/\s+/).filter(Boolean)) {
      const tryLine = line ? `${line} ${word}` : word;
      if (font.widthOfTextAtSize(tryLine, size) <= maxWidth) line = tryLine;
      else {
        if (line) lines.push(line);
        line = indent + word;
      }
    }
    lines.push(line);
  }
  return lines;
}

export async function buildWarningLetterPdf(d: LetterPdfData): Promise<Uint8Array> {
  const pdf = await PDFDocument.create();
  pdf.setTitle(`Warning letter ${d.number ?? ""}`.trim());
  pdf.setAuthor("Seven Years");
  const poppins = await embedPoppins(pdf);
  const regular = poppins?.regular ?? (await pdf.embedFont(StandardFonts.Helvetica));
  const bold = poppins?.bold ?? (await pdf.embedFont(StandardFonts.HelveticaBold));

  let head: PDFImage | null = null;
  try {
    head = await pdf.embedJpg(await readFile(path.join(process.cwd(), "public", "letterhead.jpg")));
  } catch {
    head = null;
  }

  let page: PDFPage;
  let y = TOP;
  const newPage = () => {
    page = pdf.addPage([W, H]);
    if (head) page.drawImage(head, { x: 0, y: 0, width: W, height: H });
    y = TOP;
  };
  newPage();
  const text = (value: string, opts: { x?: number; size?: number; font?: PDFFont; color?: ReturnType<typeof rgb> } = {}) => {
    const font = opts.font ?? regular;
    const size = opts.size ?? 10.5;
    page.drawText(safe(value, font), { x: opts.x ?? LEFT, y, size, font, color: opts.color ?? DARK });
  };
  const ensure = (h: number) => {
    if (y - h < BOTTOM) newPage();
  };

  // Reference and date
  const date = formatDate(d.sentAt ?? d.createdAt);
  text(`Ref: ${d.number ?? "DRAFT"}`, { size: 9.5, color: GREY });
  const dateText = `Date: ${date}`;
  text(dateText, { x: RIGHT - regular.widthOfTextAtSize(safe(dateText, regular), 9.5), size: 9.5, color: GREY });
  y -= 30;

  // Title
  const title = "WARNING LETTER";
  page!.drawText(title, { x: (W - bold.widthOfTextAtSize(title, 15)) / 2, y, size: 15, font: bold, color: PINK });
  y -= 30;

  // To
  text("To,", { size: 10 });
  y -= 15;
  text(d.staffName, { font: bold, size: 11 });
  y -= 14;
  for (const line of [`Employee code: ${d.userId}`, d.designation ? `Designation: ${d.designation}` : "", d.store ? `Store: ${d.store}` : ""].filter(Boolean)) {
    text(line, { size: 10, color: GREY });
    y -= 13;
  }
  y -= 12;

  // Subject
  const subjLines = wrap(`Subject: ${safe(d.subject, bold)}`, bold, 11, RIGHT - LEFT);
  for (const l of subjLines) {
    ensure(15);
    text(l, { font: bold, size: 11 });
    y -= 15;
  }
  y -= 8;

  // Body
  for (const l of wrap(safe(d.body, regular), regular, 10.5, RIGHT - LEFT)) {
    ensure(15);
    if (l) text(l);
    y -= l ? 15 : 9;
  }

  // Signature
  y -= 16;
  ensure(70);
  text("For Seven Years,", { size: 10.5 });
  y -= 34;
  text(d.issuedByName ?? "", { font: bold, size: 10.5 });
  y -= 14;
  if (d.issuedByRole) {
    text(d.issuedByRole, { size: 9.5, color: GREY });
    y -= 14;
  }

  // Acknowledgement
  y -= 14;
  ensure(40);
  page!.drawLine({ start: { x: LEFT, y: y + 6 }, end: { x: RIGHT, y: y + 6 }, thickness: 0.5, color: rgb(0.85, 0.85, 0.85) });
  y -= 8;
  if (d.ackAt) {
    text(`Acknowledged by ${d.staffName} in the Seven Years Care app on ${formatDate(d.ackAt)}.`, { size: 9, color: GREY });
    y -= 12;
    if (d.ackNote) {
      for (const l of wrap(`Reply: ${safe(d.ackNote, regular)}`, regular, 9, RIGHT - LEFT)) {
        ensure(12);
        text(l, { size: 9, color: GREY });
        y -= 12;
      }
    }
  } else {
    text("Please acknowledge this letter in the Seven Years Care app.", { size: 9, color: GREY });
    y -= 12;
  }
  text("This letter was issued through the Seven Years Care app and is valid without a signature.", { size: 8, color: GREY });

  return pdf.save();
}
