// Reads the text of a sales update / closing report (lib/report-format.ts) back into blocks, so the
// app and e-mails can show it as a clean card: store heading in bold, one figure per line, colours where
// they mean something. Pure (no server code): used by the alert list, the pop-up and the e-mail.
// Texts that are not a store report (other alerts, "Your sales …") return null and show as before.

export type Tone = "good" | "bad" | "warn" | "muted" | null;
export type ReportRow = { label: string; value: string; tone: Tone };
export type ReportSeg =
  | { kind: "store"; store: string; date: string; when: string; rows: ReportRow[] }
  | { kind: "total"; text: string }
  | { kind: "heading"; text: string }
  | { kind: "item"; label: string; value: string }
  | { kind: "note"; text: string; tone: Tone }
  | { kind: "link"; label: string; url: string };

const HEADER = /^([A-Z][A-Z0-9 &.'-]+) · (\d{2}-\d{2}-\d{4}) · (.+)$/;
const pctIn = (s: string) => {
  const m = /\((\d+)%\)/.exec(s);
  return m ? Number(m[1]) : null;
};

function pairs(line: string): { label: string; value: string }[] {
  return line.split(" | ").map((p) => {
    const i = p.indexOf(": ");
    return i > 0 ? { label: p.slice(0, i).trim(), value: p.slice(i + 2).trim() } : { label: "", value: p.trim() };
  });
}

function storeRows(lines: string[], closing: boolean): ReportRow[] {
  const all = lines.flatMap(pairs);
  const get = (label: string) => all.find((p) => p.label === label)?.value ?? null;
  const rows: ReportRow[] = [];
  const pace = get("Pace");
  const behind = pace ? /behind/i.test(pace) : null;

  const dt = get("Day target");
  if (dt) rows.push({ label: "Day target", value: dt, tone: null });
  const req = get("Required today");
  if (req) rows.push({ label: "Required today", value: req, tone: null });
  const ach = get("Achieved");
  if (ach) {
    const p = pctIn(ach);
    const tone: Tone = !closing ? (behind === null ? null : behind ? "bad" : "good") : p === null ? null : p >= 100 ? "good" : p >= 80 ? "warn" : "bad";
    rows.push({ label: "Achieved", value: ach, tone });
  }
  const bills = get("Bills");
  const abv = get("ABV");
  if (bills !== null) rows.push({ label: "Bills · ABV", value: `${bills}${abv ? ` · ${abv}` : ""}`, tone: null });
  if (pace) {
    const m = /behind by (₹[\d,]+)/i.exec(pace);
    rows.push({ label: "Pace", value: m ? `Behind ${m[1]}` : /on pace/i.test(pace) ? "On pace" : pace, tone: behind ? "bad" : "good" });
  }
  const mtd = get("MTD");
  if (mtd) rows.push({ label: "MTD", value: mtd.replace(/ of ₹/, " / ₹"), tone: null });
  const backlog = get("Month backlog");
  const ahead = all.find((p) => /^Ahead of plan by/i.test(p.value));
  if (backlog) rows.push({ label: "Month backlog", value: backlog, tone: null });
  else if (ahead) rows.push({ label: "Month backlog", value: ahead.value.replace(/^Ahead of plan by/i, "Ahead by"), tone: "good" });
  const w = get("Walk-ins");
  const conv = get("Conversion");
  if (w !== null) {
    if (/not posted/i.test(w)) rows.push({ label: "Walk-ins · Conv.", value: "Not posted yet", tone: "warn" });
    else {
      const pctConv = conv ? /^(\d+)%$/.exec(conv) : null;
      const check = conv ? /check/i.test(conv) || (pctConv !== null && Number(pctConv[1]) > 100) : false;
      rows.push({ label: "Walk-ins · Conv.", value: `${w} · ${check ? "⚠ Check walk-ins" : conv ?? "—"}`, tone: check ? "warn" : null });
    }
  }
  const ret = get("Returns");
  if (ret) rows.push({ label: "Returns", value: ret, tone: null });
  const ipb = get("Items per bill");
  if (ipb) rows.push({ label: "Items per bill", value: ipb, tone: null });
  const prev = get("Previous day");
  if (prev) rows.push({ label: "Previous day", value: prev, tone: null });
  return rows;
}

/** null when the text is not a store report. */
export function parseReport(body: string | null | undefined): ReportSeg[] | null {
  if (!body) return null;
  const lines = body.split("\n");
  if (!lines.some((l) => HEADER.test(l.trim()))) return null;
  const segs: ReportSeg[] = [];
  let i = 0;
  while (i < lines.length) {
    const raw = lines[i];
    const line = raw.trim();
    const h = HEADER.exec(line);
    if (h) {
      const block: string[] = [];
      i++;
      while (i < lines.length && lines[i].trim() && !HEADER.test(lines[i].trim()) && /^[A-Z][A-Za-z ·-]+: |^Ahead of plan/.test(lines[i].trim()) && !/^(Top|Team|No bills|Stock|Full report|Open|All stores|Provisional|PROVISIONAL|Walk-ins posted|Walk-ins are)/.test(lines[i].trim())) {
        block.push(lines[i].trim());
        i++;
      }
      segs.push({ kind: "store", store: h[1], date: h[2], when: h[3], rows: storeRows(block, /closing/i.test(h[3])) });
      continue;
    }
    i++;
    if (!line) continue;
    const link = /^(Open|Full report): (https?:\/\/\S+)$/.exec(line);
    if (link) segs.push({ kind: "link", label: link[1] === "Open" ? "Open the dashboard" : "Open the full report", url: link[2] });
    else if (/^All stores: /.test(line)) segs.push({ kind: "total", text: line });
    else if (/^(Team today|Top categories|Top products):?$/.test(line)) segs.push({ kind: "heading", text: line.replace(/:$/, "") });
    else if (/^\s{2}/.test(raw)) {
      const m = /^(.+?): (.+)$/.exec(line.replace(/^•\s*/, ""));
      segs.push(m ? { kind: "item", label: m[1], value: m[2] } : { kind: "note", text: line, tone: null });
    } else if (/^Provisional/i.test(line)) segs.push({ kind: "note", text: line, tone: "muted" });
    else if (/^(⚠|PROVISIONAL|Walk-ins are not posted)/.test(line)) segs.push({ kind: "note", text: line.replace(/^⚠\s*/, ""), tone: "warn" });
    else segs.push({ kind: "note", text: line, tone: null });
  }
  return segs;
}

/** One line for pop-ups and phone notifications: "PERAMBRA ₹15,120 (11%) · VATAKARA ₹2,639 (2%)". */
export function reportSummary(segs: ReportSeg[]): string {
  return segs
    .filter((s): s is Extract<ReportSeg, { kind: "store" }> => s.kind === "store")
    .map((s) => `${s.store} ${s.rows.find((r) => r.label === "Achieved")?.value ?? ""}`.trim())
    .join(" · ");
}

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const TONE_HEX: Record<string, string> = { good: "#15803d", bad: "#b91c1c", warn: "#b45309", muted: "#6b7280" };

/** The same card as an e-mail (tables and inline styles only, so every mail app shows it right). */
export function reportHtml(segs: ReportSeg[], greeting?: string): string {
  const out: string[] = [];
  if (greeting) out.push(`<p style="margin:0 0 12px">${esc(greeting)}</p>`);
  for (const s of segs) {
    if (s.kind === "store") {
      const rows = s.rows
        .map(
          (r) =>
            `<tr><td style="padding:5px 0;color:#6b7280;border-bottom:1px solid #f0f0f0">${esc(r.label)}</td><td style="padding:5px 0;text-align:right;font-weight:700;border-bottom:1px solid #f0f0f0;color:${r.tone ? TONE_HEX[r.tone] : "#161616"}">${esc(r.value)}</td></tr>`
        )
        .join("");
      out.push(
        `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:460px;margin:0 0 16px;border:1px solid #e5e7eb;border-radius:12px;border-collapse:separate;padding:12px 14px"><tr><td style="font-size:16px;font-weight:800;padding-bottom:6px;border-bottom:2px solid #8883d7">${esc(s.store)}</td><td style="text-align:right;color:#6b7280;font-size:12px;padding-bottom:6px;border-bottom:2px solid #8883d7">${esc(s.date)} · ${esc(s.when)}</td></tr>${rows}</table>`
      );
    } else if (s.kind === "total") out.push(`<p style="font-weight:800;margin:4px 0 10px">${esc(s.text)}</p>`);
    else if (s.kind === "heading") out.push(`<p style="font-weight:800;margin:14px 0 4px">${esc(s.text)}</p>`);
    else if (s.kind === "item")
      out.push(`<div style="max-width:460px;display:flex;justify-content:space-between;border-bottom:1px solid #f0f0f0;padding:3px 0"><span>${esc(s.label)}</span><b>${esc(s.value)}</b></div>`);
    else if (s.kind === "link") out.push(`<p style="margin:12px 0"><a href="${esc(s.url)}" style="color:#5b55c4;font-weight:700">${esc(s.label)} →</a></p>`);
    else out.push(`<p style="margin:4px 0;color:${s.tone ? TONE_HEX[s.tone] : "#161616"};${s.tone === "muted" ? "font-size:12px" : ""}">${esc(s.text)}</p>`);
  }
  return `<div style="font-family:Arial,sans-serif;font-size:14px;line-height:1.5;color:#161616">${out.join("")}</div>`;
}
