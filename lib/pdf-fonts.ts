// Poppins for PDFs (same typeface as sevenyears.in and the app). Server only.
// The font files are downloaded once by the server and kept in memory; if they
// can't be reached, PDFs fall back to the built-in Helvetica so nothing breaks.

import type { PDFDocument, PDFFont } from "pdf-lib";

const SOURCES = [
  "https://cdn.jsdelivr.net/gh/google/fonts@main/ofl/poppins/",
  "https://raw.githubusercontent.com/google/fonts/main/ofl/poppins/",
];

type Files = { regular: Uint8Array; bold: Uint8Array };
let cached: Files | null = null;
let failedAt = 0;

async function download(name: string) {
  for (const base of SOURCES) {
    try {
      const response = await fetch(`${base}${name}`, { signal: AbortSignal.timeout(8000), cache: "force-cache" });
      if (!response.ok) continue;
      const bytes = new Uint8Array(await response.arrayBuffer());
      // TrueType files start with 00 01 00 00 (or "true").
      if (bytes.length > 10_000 && ((bytes[0] === 0 && bytes[1] === 1) || bytes[0] === 0x74)) return bytes;
    } catch {
      // try the next source
    }
  }
  return null;
}

async function poppinsFiles(): Promise<Files | null> {
  if (cached) return cached;
  if (Date.now() - failedAt < 10 * 60 * 1000) return null; // don't retry on every PDF after a failure
  const [regular, bold] = await Promise.all([download("Poppins-Regular.ttf"), download("Poppins-SemiBold.ttf")]);
  if (!regular || !bold) {
    failedAt = Date.now();
    console.warn("Poppins font download failed — PDFs use Helvetica for now.");
    return null;
  }
  cached = { regular, bold };
  return cached;
}

/** Poppins (regular + semibold) embedded in this PDF, or null to use the standard fonts. */
export async function embedPoppins(pdf: PDFDocument): Promise<{ regular: PDFFont; bold: PDFFont } | null> {
  const files = await poppinsFiles();
  if (!files) return null;
  try {
    const fontkit = (await import("@pdf-lib/fontkit")).default;
    pdf.registerFontkit(fontkit);
    const [regular, bold] = await Promise.all([pdf.embedFont(files.regular), pdf.embedFont(files.bold)]);
    return { regular, bold };
  } catch (error) {
    console.warn("Embedding Poppins in the PDF failed — using Helvetica:", error);
    return null;
  }
}
