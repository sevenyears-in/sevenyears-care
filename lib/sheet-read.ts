// Reads the first sheet of an .xlsx file, or a .csv file, in the browser (no extra packages).
// Returns rows of cell text. Client-safe.

async function inflateRaw(data: Uint8Array): Promise<Uint8Array> {
  const stream = new Blob([data as BlobPart]).stream().pipeThrough(new DecompressionStream("deflate-raw"));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

/** Files inside a .zip (an .xlsx is a zip). Only the names asked for are unpacked. */
async function unzip(buf: ArrayBuffer, wanted: (name: string) => boolean): Promise<Map<string, string>> {
  const view = new DataView(buf);
  const bytes = new Uint8Array(buf);
  // End of central directory.
  let eocd = -1;
  for (let i = bytes.length - 22; i >= Math.max(0, bytes.length - 66000); i--) {
    if (view.getUint32(i, true) === 0x06054b50) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) throw new Error("This is not a valid Excel (.xlsx) file.");
  const count = view.getUint16(eocd + 10, true);
  let p = view.getUint32(eocd + 16, true);
  const out = new Map<string, string>();
  const dec = new TextDecoder();
  for (let n = 0; n < count; n++) {
    if (view.getUint32(p, true) !== 0x02014b50) break;
    const method = view.getUint16(p + 10, true);
    const size = view.getUint32(p + 20, true);
    const nameLen = view.getUint16(p + 28, true);
    const extraLen = view.getUint16(p + 30, true);
    const commentLen = view.getUint16(p + 32, true);
    const local = view.getUint32(p + 42, true);
    const name = dec.decode(bytes.subarray(p + 46, p + 46 + nameLen));
    p += 46 + nameLen + extraLen + commentLen;
    if (!wanted(name)) continue;
    const lNameLen = view.getUint16(local + 26, true);
    const lExtraLen = view.getUint16(local + 28, true);
    const start = local + 30 + lNameLen + lExtraLen;
    const raw = bytes.subarray(start, start + size);
    const data = method === 0 ? raw : await inflateRaw(raw);
    out.set(name, dec.decode(data));
  }
  return out;
}

const colIndex = (ref: string) => {
  const letters = ref.replace(/[^A-Z]/g, "");
  let n = 0;
  for (const ch of letters) n = n * 26 + (ch.charCodeAt(0) - 64);
  return n - 1;
};

/** Excel date serial → YYYY-MM-DD. */
export function excelDate(serial: number) {
  const ms = Math.round((serial - 25569) * 86400 * 1000);
  return new Date(ms).toISOString().slice(0, 10);
}

async function readXlsx(buf: ArrayBuffer): Promise<string[][]> {
  const files = await unzip(buf, (n) => n === "xl/sharedStrings.xml" || n === "xl/workbook.xml" || n === "xl/_rels/workbook.xml.rels" || /^xl\/worksheets\/sheet\d+\.xml$/.test(n) || n === "xl/styles.xml");
  const parser = new DOMParser();
  const shared: string[] = [];
  const ss = files.get("xl/sharedStrings.xml");
  if (ss) {
    const doc = parser.parseFromString(ss, "application/xml");
    for (const si of Array.from(doc.getElementsByTagName("si"))) shared.push(Array.from(si.getElementsByTagName("t")).map((t) => t.textContent ?? "").join(""));
  }
  // Date formats (so date cells become YYYY-MM-DD).
  const dateStyles = new Set<number>();
  const st = files.get("xl/styles.xml");
  if (st) {
    const doc = parser.parseFromString(st, "application/xml");
    const custom = new Map<number, string>();
    for (const f of Array.from(doc.getElementsByTagName("numFmt"))) custom.set(Number(f.getAttribute("numFmtId")), f.getAttribute("formatCode") ?? "");
    const xfs = doc.getElementsByTagName("cellXfs")[0];
    Array.from(xfs?.getElementsByTagName("xf") ?? []).forEach((xf, i) => {
      const id = Number(xf.getAttribute("numFmtId"));
      const code = custom.get(id) ?? "";
      if ((id >= 14 && id <= 22) || (id >= 45 && id <= 47) || /[dy]/i.test(code.replace(/"[^"]*"/g, ""))) dateStyles.add(i);
    });
  }
  // First sheet in workbook order.
  let sheetPath = [...files.keys()].filter((k) => k.startsWith("xl/worksheets/")).sort()[0];
  const wb = files.get("xl/workbook.xml");
  const rels = files.get("xl/_rels/workbook.xml.rels");
  if (wb && rels) {
    const first = parser.parseFromString(wb, "application/xml").getElementsByTagName("sheet")[0];
    const rid = first?.getAttribute("r:id") ?? first?.getAttributeNS("http://schemas.openxmlformats.org/officeDocument/2006/relationships", "id");
    const rel = Array.from(parser.parseFromString(rels, "application/xml").getElementsByTagName("Relationship")).find((r) => r.getAttribute("Id") === rid);
    const target = rel?.getAttribute("Target");
    if (target) sheetPath = target.startsWith("/") ? target.slice(1) : `xl/${target}`;
  }
  const xml = sheetPath ? files.get(sheetPath) : undefined;
  if (!xml) throw new Error("No sheet found in the file.");
  const doc = parser.parseFromString(xml, "application/xml");
  const rows: string[][] = [];
  for (const row of Array.from(doc.getElementsByTagName("row"))) {
    const out: string[] = [];
    for (const c of Array.from(row.getElementsByTagName("c"))) {
      const idx = colIndex(c.getAttribute("r") ?? "A");
      const type = c.getAttribute("t");
      const s = Number(c.getAttribute("s") ?? -1);
      const v = c.getElementsByTagName("v")[0]?.textContent ?? "";
      let text = v;
      if (type === "s") text = shared[Number(v)] ?? "";
      else if (type === "inlineStr") text = Array.from(c.getElementsByTagName("t")).map((t) => t.textContent ?? "").join("");
      else if (v && dateStyles.has(s) && /^\d+(\.\d+)?$/.test(v)) text = excelDate(Number(v));
      out[idx] = text.trim();
    }
    rows.push(Array.from(out, (x) => x ?? ""));
  }
  return rows;
}

function readCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let q = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (q) {
      if (ch === '"' && text[i + 1] === '"') {
        cell += '"';
        i++;
      } else if (ch === '"') q = false;
      else cell += ch;
    } else if (ch === '"') q = true;
    else if (ch === ",") {
      row.push(cell.trim());
      cell = "";
    } else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && text[i + 1] === "\n") i++;
      row.push(cell.trim());
      rows.push(row);
      row = [];
      cell = "";
    } else cell += ch;
  }
  if (cell || row.length) {
    row.push(cell.trim());
    rows.push(row);
  }
  return rows;
}

/** Rows of the file; the header row is the first row with at least 3 filled cells. */
export async function readSheet(file: File): Promise<{ header: string[]; rows: string[][] }> {
  const all = /\.csv$/i.test(file.name) ? readCsv((await file.text()).replace(/^﻿/, "")) : await readXlsx(await file.arrayBuffer());
  const h = all.findIndex((r) => r.filter(Boolean).length >= 3);
  if (h < 0) throw new Error("The file has no header row.");
  return { header: all[h].map((x) => x.trim()), rows: all.slice(h + 1).filter((r) => r.some(Boolean)) };
}

/** Text date (Excel, "11/11/2026", "11-Nov-2026", "2026-11-11") → YYYY-MM-DD, or null. */
export function toISODate(v: string): string | null {
  const s = v.trim();
  if (/^\d{4}-\d{2}-\d{2}/.test(s)) return s.slice(0, 10);
  if (/^\d{5}(\.\d+)?$/.test(s)) return excelDate(Number(s));
  let m = s.match(/^(\d{1,2})[/.-](\d{1,2})[/.-](\d{2,4})/);
  if (m) {
    const y = m[3].length === 2 ? `20${m[3]}` : m[3];
    return `${y}-${m[2].padStart(2, "0")}-${m[1].padStart(2, "0")}`; // day first (India)
  }
  m = s.match(/^(\d{1,2})[ -]([A-Za-z]{3})[a-z]*[ -,]*(\d{4})/);
  if (m) {
    const mon = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"].indexOf(m[2].toLowerCase()) + 1;
    if (mon) return `${m[3]}-${String(mon).padStart(2, "0")}-${m[1].padStart(2, "0")}`;
  }
  return null;
}

export const toNumber = (v: string) => {
  const n = Number(String(v ?? "").replace(/[₹,\s]/g, "").replace(/^\((.*)\)$/, "-$1"));
  return Number.isFinite(n) ? n : NaN;
};
