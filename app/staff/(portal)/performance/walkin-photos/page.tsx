import Link from "next/link";
import { redirect } from "next/navigation";
import { getCurrentStaff } from "@/lib/auth";
import { formatDate } from "@/lib/helpers";
import { istNow } from "@/lib/business-day";
import { supabaseAdmin } from "@/lib/supabase/server";
import { eventPhotos } from "@/lib/cctv";
import { loadMarks } from "@/lib/camera-ai";
import { RecheckButton, WalkinMark } from "@/components/WalkinMark";

export const dynamic = "force-dynamic";
export const metadata = { title: "Walk-in photos" };

type Person = { where?: string; clothes?: string; staff?: boolean; moving?: string; new?: boolean };
type Ai = { people?: number; staff?: number; customers?: number; groups?: number; direction?: string; skipped?: boolean; error?: string; persons?: Person[] } | null;
const MOVING: Record<string, string> = { in: "coming in", out: "going out", inside: "walking inside", still: "standing / working" };
type Row = { id: number; event_at: string; ai: Ai };
type Kind = "counted" | "same" | "waiting" | "staff" | "out" | "nobody" | "unusable" | "markedStaff";

const LABEL: Record<Kind, { text: string; cls: string }> = {
  counted: { text: "Counted", cls: "bg-green-100 text-green-800" },
  same: { text: "Same group as the photo before", cls: "bg-green-50 text-green-700" },
  waiting: { text: "Being checked by the AI — not counted yet", cls: "bg-amber-100 text-amber-900" },
  staff: { text: "Staff only — not counted", cls: "bg-black/5 text-black/60" },
  out: { text: "Going out — not counted", cls: "bg-black/5 text-black/60" },
  nobody: { text: "Nobody walking in — not counted", cls: "bg-black/5 text-black/60" },
  unusable: { text: "Photo not usable — not counted", cls: "bg-black/5 text-black/60" },
  markedStaff: { text: "Marked not a walk-in — not counted", cls: "bg-black/5 text-black/60" },
};

const clock = (iso: string) => new Date(iso).toLocaleTimeString("en-IN", { hour: "numeric", minute: "2-digit", second: "2-digit", timeZone: "Asia/Kolkata" });

// The doorway photos behind today's camera walk-in count (management only: CCTV photos).
export default async function WalkinPhotosPage({ searchParams }: { searchParams: Promise<{ store?: string; day?: string; show?: string }> }) {
  const staff = await getCurrentStaff();
  if (!staff) redirect("/staff/login");
  if (!["super_admin", "director", "admin", "operations_manager"].includes(staff.role)) redirect("/staff/performance");
  const sp = await searchParams;
  const { loadCctv } = await import("@/lib/cctv");
  const { links, watch } = await loadCctv();
  const stores = links.filter((l) => l.channels.length).map((l) => l.store).sort();
  const store = stores.includes((sp.store ?? "").toUpperCase()) ? (sp.store ?? "").toUpperCase() : stores[0];
  const day = /^\d{4}-\d{2}-\d{2}$/.test(sp.day ?? "") ? sp.day! : istNow().date;
  const show = sp.show === "all" ? "all" : "counted";
  const link = links.find((l) => l.store === store);
  if (!link || !watch.walkinCode) {
    return <p className="rounded-2xl bg-white p-5 text-sm">Walk-ins from the camera are not set up.</p>;
  }

  const from = new Date(Date.parse(`${day}T00:00:00+05:30`)).toISOString();
  const to = new Date(Date.parse(`${day}T00:00:00+05:30`) + 86_400_000).toISOString();
  const { data } = await supabaseAdmin
    .from("cctv_events")
    .select("id, event_at, ai")
    .eq("store", store)
    .in("channel", link.channels)
    .gte("event_at", from)
    .lt("event_at", to)
    .not("photo_path", "is", null)
    .filter("raw->sub_type", "cs", `[${watch.walkinCode}]`)
    .order("event_at")
    .limit(2000);
  const rows = (data ?? []) as Row[];
  const marks = await loadMarks(rows.map((r) => r.id)).catch(() => new Map<number, { verdict: string; note: string | null; by_name: string | null }>());

  // Same rules as the count (lib/walkins.ts): photos a few seconds apart are one arrival.
  let prev = -Infinity;
  let burstCounted = false;
  const items: (Row & { kind: Kind; customers: number; groups: number })[] = [];
  for (const r of rows) {
    const t = Date.parse(r.event_at);
    const ai = r.ai;
    const mark = marks.get(r.id)?.verdict;
    let kind: Kind;
    let customers = 0;
    if (mark === "staff") kind = "markedStaff";
    else if (mark === "customer") kind = "counted";
    else if (ai && typeof ai.people !== "number") kind = "unusable";
    else if (!ai) kind = "waiting";
    else if (ai.direction === "out") kind = "out";
    else if (!ai.customers) kind = ai.staff ? "staff" : "nobody";
    else kind = "counted";
    if (kind === "counted") customers = mark === "customer" ? Math.max(1, ai?.customers ?? 1) : ai?.customers ?? 0;
    const sameBurst = t - prev <= watch.groupSec * 1000;
    if (kind !== "unusable") prev = t;
    if (!sameBurst) burstCounted = false;
    const counts = kind === "counted";
    if (counts && burstCounted) kind = "same";
    if (counts) burstCounted = true;
    items.push({ ...r, kind, customers, groups: kind === "counted" ? Math.max(1, ai?.groups ?? 1) : 0 });
  }
  const counted = items.filter((i) => i.kind === "counted" || i.kind === "same");
  const list = show === "all" ? items.filter((i) => i.kind !== "waiting") : items.filter((i) => counted.includes(i) || i.kind === "markedStaff");
  const urls = await eventPhotos(list.map((i) => i.id)).catch(() => new Map<number, string>());
  const customers = counted.reduce((n, i) => n + i.customers, 0);
  const q = (o: Record<string, string>) => `?${new URLSearchParams({ store, day, ...(show === "all" ? { show } : {}), ...o })}`;

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="text-xs font-bold uppercase tracking-[0.18em] text-[#ff5e79]">Camera count (trial)</p>
          <h1 className="mt-1 text-2xl font-bold sm:text-3xl">
            Walk-in photos · {store} · {formatDate(day)}
          </h1>
          <p className="mt-1 text-sm text-black/55">
            {customers} customer(s) in {counted.length} photo(s) · {items.filter((i) => i.kind !== "waiting").length} doorway photo(s) in all
          </p>
          <p className="mt-1 text-xs text-black/50">
            Wrong? Use <b>✗ Not a walk-in</b> (or <b>✓ This is a customer</b> under &ldquo;All doorway photos&rdquo;). The count changes at once, and the AI learns from your marks for this store.
          </p>
        </div>
        <Link href={`/staff/performance?view=team&store=${encodeURIComponent(store)}`} className="rounded-full bg-white px-4 py-2 text-sm font-semibold ring-1 ring-black/10 hover:bg-black/5">
          ← Store dashboard
        </Link>
      </div>

      <div className="flex flex-wrap gap-2">
        {stores.map((s) => (
          <Link key={s} href={`?${new URLSearchParams({ store: s, day, ...(show === "all" ? { show } : {}) })}`} className={`rounded-full px-4 py-1.5 text-sm font-bold ${s === store ? "bg-[#8883d7] text-white" : "bg-white ring-1 ring-black/10"}`}>
            {s}
          </Link>
        ))}
        <span className="mx-1" />
        <Link href={`?${new URLSearchParams({ store, day })}`} className={`rounded-full px-4 py-1.5 text-sm font-bold ${show === "counted" ? "bg-black text-white" : "bg-white ring-1 ring-black/10"}`}>
          Counted only
        </Link>
        <Link href={q({ show: "all" })} className={`rounded-full px-4 py-1.5 text-sm font-bold ${show === "all" ? "bg-black text-white" : "bg-white ring-1 ring-black/10"}`}>
          All doorway photos
        </Link>
        {day === istNow().date && <RecheckButton store={store} />}
      </div>

      {!list.length && <p className="rounded-2xl bg-white p-5 text-sm text-black/60">No photos.</p>}
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {list.map((i) => {
          const url = urls.get(i.id);
          return (
            <div key={i.id} className="overflow-hidden rounded-2xl bg-white soft-card ring-1 ring-black/5">
              {url ? (
                <a href={url} target="_blank" rel="noreferrer">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={url} alt={`Doorway ${clock(i.event_at)}`} className="aspect-[4/3] w-full object-cover" loading="lazy" />
                </a>
              ) : (
                <div className="flex aspect-[4/3] items-center justify-center bg-black/5 text-xs text-black/40">No photo</div>
              )}
              <div className="flex flex-wrap items-center justify-between gap-2 px-3 py-2">
                <p className="text-sm font-bold tabular-nums">{clock(i.event_at)}</p>
                <span className={`rounded-full px-2 py-0.5 text-[11px] font-bold ${LABEL[i.kind].cls}`}>
                  {i.kind === "counted" ? `${i.customers} customer(s)${i.groups > 1 ? ` · ${i.groups} groups` : ""}` : i.kind === "same" && i.customers ? `${i.customers} customer(s) · ${LABEL.same.text.toLowerCase()}` : LABEL[i.kind].text}
                </span>
              </div>
              {i.kind !== "unusable" && (
                <WalkinMark
                  id={i.id}
                  counted={i.kind === "counted" || i.kind === "same"}
                  mark={(() => {
                    const m = marks.get(i.id);
                    return m ? { verdict: m.verdict === "customer" ? "customer" : "staff", note: m.note, by: m.by_name } : null;
                  })()}
                />
              )}
              {Array.isArray(i.ai?.persons) && i.ai.persons.length > 0 && (
                <details className="px-3 pb-2 text-[11px] text-black/60">
                  <summary className="cursor-pointer font-semibold">What the AI saw</summary>
                  <ul className="mt-1 space-y-0.5">
                    {i.ai.persons.map((p, n) => (
                      <li key={n}>
                        <b className={p.staff === false ? "text-green-700" : "text-black/70"}>{p.staff === false ? "Customer" : "Staff"}</b> · {MOVING[p.moving ?? ""] ?? p.moving ?? "—"}
                        {p.staff === false && p.new === false ? " · already counted" : ""} · {p.clothes ?? ""}
                        {p.where ? ` (${p.where})` : ""}
                      </li>
                    ))}
                  </ul>
                </details>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
