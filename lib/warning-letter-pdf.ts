// Warning letter PDF on the Seven Years letterhead, A4 (595 × 842 pt). Server only.
// public/letterhead-a4.jpg is the letterhead laid out on A4 (logo and watermark, made from
// public/letterhead.jpg without stretching); the footer (company name, address, contacts) is drawn
// here as text so it stays sharp and easy to change. The letter text sits between the logo and the
// purple line, and runs onto more pages if needed.

import { readFile } from "node:fs/promises";
import path from "node:path";
import { degrees, PDFDocument, rgb, StandardFonts, type PDFFont, type PDFImage, type PDFPage } from "pdf-lib";
import { embedPoppins } from "@/lib/pdf-fonts";
import { formatDate } from "@/lib/helpers";

/** Footer on every page of the letter. */
const FOOTER = {
  line1: "SEVEN YEARS KIDS CARE LLP  ·  Near Passport Seva Kendra, Edodi, Vatakara  ·  T +91 8330 070707",
  line2: "sevenyears070707@gmail.com   ·   www.sevenyears.in   ·   Instagram: seven_years_babyshop   ·   Facebook: sevenyearsbabyshop",
};
const FOOTER_PURPLE = rgb(137 / 255, 133 / 255, 210 / 255);
const FOOTER_TEAL = rgb(40 / 255, 176 / 255, 192 / 255);

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
  revokedAt?: string | null;
  revokedBy?: string | null;
  revokeReason?: string | null;
  /** The issuer's handwritten signature (PNG / JPEG). */
  signature?: { bytes: Uint8Array; type: string } | null;
};

const W = 595.28;
const H = 841.89;
const LEFT = 60;
const RIGHT = W - 60;
const TOP = H - 118; // below the logo
const BOTTOM = 72; // above the purple line (drawn at 50–55 pt)
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
    let line = "";
    for (const word of para.split(/\s+/).filter(Boolean)) {
      const tryLine = line ? `${line} ${word}` : word;
      if (font.widthOfTextAtSize(tryLine, size) <= maxWidth) line = tryLine;
      else {
        if (line) lines.push(line);
        line = word;
      }
    }
    lines.push(line);
  }
  return lines;
}

/** Lines of one paragraph, each with its words; every line but the last is justified. */
function layout(text: string, font: PDFFont, size: number, maxWidth: number): { words: string[]; last: boolean }[] {
  const out: { words: string[]; last: boolean }[] = [];
  let cur: string[] = [];
  for (const word of text.split(/\s+/).filter(Boolean)) {
    const tryLine = [...cur, word].join(" ");
    if (!cur.length || font.widthOfTextAtSize(tryLine, size) <= maxWidth) cur.push(word);
    else {
      out.push({ words: cur, last: false });
      cur = [word];
    }
  }
  if (cur.length) out.push({ words: cur, last: true });
  return out;
}

/** Letter body as blocks: paragraphs, bullet points ("- " / "• ") and blank lines. */
export function letterBlocks(body: string): { kind: "p" | "li" | "gap"; text: string }[] {
  const out: { kind: "p" | "li" | "gap"; text: string }[] = [];
  for (const raw of body.replace(/\r/g, "").split("\n")) {
    const line = raw.trim();
    if (!line) {
      if (out.length && out[out.length - 1].kind !== "gap") out.push({ kind: "gap", text: "" });
      continue;
    }
    const m = /^[-•*]\s+(.*)$/.exec(line);
    out.push(m ? { kind: "li", text: m[1] } : { kind: "p", text: line });
  }
  while (out.length && out[out.length - 1].kind === "gap") out.pop();
  return out;
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
    head = await pdf.embedJpg(await readFile(path.join(process.cwd(), "public", "letterhead-a4.jpg")));
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

  // Body: justified paragraphs, bullet points with a hanging indent.
  const SIZE = 10.5;
  const LEAD = SIZE * 1.2; // single line spacing
  const justify = (words: string[], x: number, width: number, last: boolean) => {
    const ws = words.map((w) => safe(w, regular));
    if (last || ws.length < 2) {
      page.drawText(ws.join(" "), { x, y, size: SIZE, font: regular, color: DARK });
      return;
    }
    const used = ws.reduce((t, w) => t + regular.widthOfTextAtSize(w, SIZE), 0);
    const gap = (width - used) / (ws.length - 1);
    let cx = x;
    for (const w of ws) {
      page.drawText(w, { x: cx, y, size: SIZE, font: regular, color: DARK });
      cx += regular.widthOfTextAtSize(w, SIZE) + gap;
    }
  };
  const BULLET_X = LEFT + 8;
  const BULLET_TEXT = LEFT + 22;
  let prev: string | null = null;
  for (const b of letterBlocks(d.body)) {
    if (b.kind === "gap") {
      y -= 6;
      prev = "gap";
      continue;
    }
    if (b.kind === "li" && prev === "p") y -= 2;
    const x = b.kind === "li" ? BULLET_TEXT : LEFT;
    const width = RIGHT - x;
    const lines = layout(safe(b.text, regular), regular, SIZE, width);
    lines.forEach((l, i) => {
      ensure(LEAD);
      if (b.kind === "li" && i === 0) page.drawText("•", { x: BULLET_X, y, size: SIZE, font: bold, color: PINK });
      justify(l.words, x, width, l.last);
      y -= LEAD;
    });
    if (b.kind === "li") y -= 1;
    prev = b.kind;
  }

  // Signature
  y -= 16;
  ensure(70);
  text("For Seven Years Kids Care LLP,", { size: 10.5 });
  let sigImg: PDFImage | null = null;
  if (d.signature) {
    try {
      sigImg = d.signature.type === "image/png" ? await pdf.embedPng(d.signature.bytes) : await pdf.embedJpg(d.signature.bytes);
    } catch {
      sigImg = null;
    }
  }
  if (sigImg) {
    const h = 50;
    const w = Math.min(170, (sigImg.width / sigImg.height) * h);
    const hh = (sigImg.height / sigImg.width) * w;
    ensure(hh + 30);
    page!.drawImage(sigImg, { x: LEFT - 4, y: y - hh - 2, width: w, height: hh });
    y -= hh + 14;
  } else y -= 34;
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
  text(sigImg ? "This letter was issued through the Seven Years Care app." : "This letter was issued through the Seven Years Care app and is valid without a signature.", { size: 8, color: GREY });

  // Footer on every page: purple line, company name and address, contacts (shrunk to fit).
  for (const pg of pdf.getPages()) {
    pg.drawRectangle({ x: 0, y: 50, width: W, height: 5, color: FOOTER_PURPLE });
    const line = (t: string, font: PDFFont, size0: number, yy: number, color: ReturnType<typeof rgb>) => {
      const txt = safe(t, font);
      let size = size0;
      while (size > 6 && font.widthOfTextAtSize(txt, size) > W - 60) size -= 0.25;
      pg.drawText(txt, { x: (W - font.widthOfTextAtSize(txt, size)) / 2, y: yy, size, font, color });
    };
    line(FOOTER.line1, bold, 8.5, 34, FOOTER_TEAL);
    line(FOOTER.line2, regular, 8, 20, GREY);
  }

  // Revoked: a stamp across every page and a note at the end.
  if (d.revokedAt) {
    const stamp = "REVOKED";
    const red = rgb(0.86, 0.15, 0.2);
    for (const pg of pdf.getPages()) {
      const size = 72;
      const w = bold.widthOfTextAtSize(stamp, size);
      pg.drawText(stamp, { x: W / 2 - (w / 2) * Math.cos(Math.PI / 6), y: H / 2 - (w / 2) * Math.sin(Math.PI / 6), size, font: bold, color: red, opacity: 0.22, rotate: degrees(30) });
    }
    y -= 18;
    ensure(30);
    const note = `Revoked on ${formatDate(d.revokedAt)}${d.revokedBy ? ` by ${d.revokedBy}` : ""}${d.revokeReason ? `: ${d.revokeReason}` : ""}. This letter is no longer in force.`;
    for (const l of wrap(safe(note, bold), bold, 9.5, RIGHT - LEFT)) {
      ensure(12);
      text(l, { font: bold, size: 9.5, color: red });
      y -= 12.5;
    }
  }

  return pdf.save();
}
