import Link from "next/link";
import { redirect } from "next/navigation";
import { getCurrentStaff } from "@/lib/auth";
import { formatDate, todayISO } from "@/lib/helpers";
import { monthReport } from "@/lib/performance";
import { merchStores } from "@/lib/merch-access";
import { CAM_MATCH_MIN, clockIST, loadCamChecks, loadCamEdges, loadOpenCloseHistory, openCloseStores, punchMoments, type CamCheck as Check, type CamEdge, type OpenClose, type Sop } from "@/lib/store-open-close";
import { ApproveSop } from "@/components/ApproveSop";
import { CamCheck, type CamPhotoView } from "@/components/CamCheck";
import { cctvSince, eventPhotos, photosAtPunches } from "@/lib/cctv";
import { canWriteLetters, smOfStore } from "@/lib/warning-letters";

export const dynamic = "force-dynamic";
export const metadata = { title: "Store opening & closing" };

const BADGE: Record<Sop, { text: string; cls: string }> = {
  ok: { text: "As per SOP", cls: "bg-green-50 text-green-700" },
  violation: { text: "SOP violation", cls: "bg-red-100 text-red-800" },
  approved: { text: "Approved", cls: "bg-amber-100 text-amber-800" },
};

type Cam = { photos: CamPhotoView[]; check: Check | null; missing: boolean } | null;

/** First person the entrance camera saw (opening) / last person (closing), matched with the punches. */
function EntryExit({ kind, edge, photo }: { kind: "open" | "close"; edge: CamEdge; photo: string | null }) {
  if (!edge.flag) return null;
  if (edge.flag === "none") return <p className="mt-1 text-[11px] text-black/40">🎥 No entrance-camera picture {kind === "open" ? "in the morning" : "at night"}</p>;
  const ok = edge.flag === "ok";
  return (
    <div className={`mt-2 rounded-xl p-2 ring-1 ${ok ? "bg-green-50/60 ring-green-100" : "bg-red-50 ring-red-100"}`}>
      <p className={`text-[11px] font-bold ${ok ? "text-green-800" : "text-red-800"}`}>
        🎥 {kind === "open" ? "First in" : "Last out"} {edge.at ? clockIST(edge.at) : ""} · {ok ? `matches an allowed person's punch (±${CAM_MATCH_MIN} min)` : kind === "open" ? "entered before an allowed person" : "left after the allowed person"}
      </p>
      {edge.note && <p className="mt-0.5 text-[11px] text-red-800/80">{edge.note}</p>}
      {photo && (
        <a href={photo} target="_blank" rel="noreferrer" className="mt-1 block">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={photo} alt={kind === "open" ? "First person in" : "Last person out"} className="h-24 w-auto rounded-lg object-cover" />
        </a>
      )}
    </div>
  );
}

function Cell({ r, kind, canApprove, cam, warnTo, edge, edgePhoto }: { r: OpenClose; kind: "open" | "close"; canApprove: boolean; cam: Cam; warnTo: string | null; edge: CamEdge | null; edgePhoto: string | null }) {
  const at = kind === "open" ? r.openedAt : r.closedAt;
  const by = kind === "open" ? r.openedBy : r.closedBy;
  const sop = kind === "open" ? r.openSop : r.closeSop;
  const approval = kind === "open" ? r.openApproval : r.closeApproval;
  if (!at) return <td className="px-3 py-2 text-black/40">—</td>;
  return (
    <td className="px-3 py-2 align-top">
      <p className="font-semibold tabular-nums">{clockIST(at)}</p>
      {by && <p className="text-xs text-black/60">{by}</p>}
      {sop && <span className={`mt-1 inline-block rounded-full px-2 py-0.5 text-[10px] font-bold uppercase ${BADGE[sop].cls}`}>{BADGE[sop].text}</span>}
      {approval && <p className="mt-0.5 text-[11px] text-black/50">Approved by {approval}</p>}
      {sop === "violation" && canApprove && (
        <div className="mt-1">
          <ApproveSop day={r.day} store={r.store} kind={kind} />
        </div>
      )}
      {edge && <EntryExit kind={kind} edge={edge} photo={edgePhoto} />}
      {(sop === "violation" || edge?.flag === "early" || edge?.flag === "late") && warnTo && (
        <Link
          href={`/staff/letters?code=${encodeURIComponent(warnTo)}&kind=sop`}
          className="mt-1 inline-block text-[11px] font-bold text-[#ff5e79] hover:underline"
        >
          ✉️ Warning letter to the SM
        </Link>
      )}
      {cam && by && (
        <CamCheck
          day={r.day}
          store={r.store}
          kind={kind}
          name={by.replace(/\s*\([^)]*\)\s*$/, "")}
          photos={cam.photos}
          check={cam.check}
          canCheck={canApprove}
          missing={cam.missing}
        />
      )}
    </td>
  );
}

export default async function OpenClosePage({ searchParams }: { searchParams: Promise<{ store?: string }> }) {
  const staff = await getCurrentStaff();
  if (!staff) redirect("/staff/login");
  const sp = await searchParams;
  const [report, machineStores] = await Promise.all([monthReport(todayISO().slice(0, 7)).catch(() => null), openCloseStores()]);
  // Stores not tracked for sales targets (e.g. PERINTHALMANNA) still have a punching machine.
  const stores = await merchStores(staff, [...new Set([...(report?.stores ?? []).map((s) => s.store), ...machineStores])]);
  if (!stores.length) redirect("/staff/performance");
  const want = (sp.store ?? "").toUpperCase();
  const store = stores.includes(want) ? want : stores[0];
  const rows = await loadOpenCloseHistory(store, 60).catch(() => []);
  const canApprove = staff.role === "director" || staff.role === "super_admin";
  const canWarn = canWriteLetters(staff.role);
  const violations = rows.filter((r) => r.openSop === "violation" || r.closeSop === "violation").length;

  // CCTV photos at the opener's / closer's punch (management only), from the day the store's NVR started sending.
  const seesCamera = canApprove || staff.role === "admin" || staff.role === "operations_manager";
  const since = seesCamera ? await cctvSince(store).catch(() => null) : null;
  const camDays = since ? rows.filter((r) => r.day >= since).map((r) => r.day) : [];
  const [moments, checks] = await Promise.all([
    punchMoments(store, camDays).catch(() => new Map<string, { open: number | null; close: number | null }>()),
    loadCamChecks(store, camDays).catch(() => new Map<string, { open: Check | null; close: Check | null }>()),
  ]);
  const punchTimes = [...moments.values()].flatMap((m) => [m.open, m.close]).filter((x): x is number => typeof x === "number");
  const photos = await photosAtPunches(store, punchTimes).catch(() => new Map<number, CamPhotoView[]>());
  const camOf = (day: string, kind: "open" | "close"): Cam => {
    if (!camDays.includes(day)) return null;
    const at = moments.get(day)?.[kind] ?? null;
    const list = at !== null ? photos.get(at) ?? [] : [];
    // A punch only just made may not have its photo yet.
    const recent = at !== null && Date.now() - at < 10 * 60_000;
    return { photos: list, check: checks.get(day)?.[kind] ?? null, missing: at !== null && !list.length && !recent };
  };
  // Entrance camera vs punches (first in / last out): Directors, SM, Super Admin, HR (and management).
  const seesEdges = seesCamera || ["hr_head", "hr_executive", "store_manager"].includes(staff.role);
  const edges = seesEdges && since ? await loadCamEdges(store, camDays).catch(() => new Map<string, { open: CamEdge; close: CamEdge }>()) : new Map<string, { open: CamEdge; close: CamEdge }>();
  const edgeUrls = await eventPhotos([...edges.values()].flatMap((e) => [e.open.event, e.close.event]).filter((x): x is number => typeof x === "number")).catch(() => new Map<number, string>());
  const edgeOf = (day: string, kind: "open" | "close") => edges.get(day)?.[kind] ?? null;
  const edgePhotoOf = (day: string, kind: "open" | "close") => {
    const id = edges.get(day)?.[kind]?.event;
    return typeof id === "number" ? edgeUrls.get(id) ?? null : null;
  };
  // SOP warnings go to the store's SM (the SM answers for who opens and closes the store).
  const sm = canWarn ? (report?.stores.find((s) => s.store === store)?.people.find((p) => p.group === "sm") ?? null) : null;
  const smCode = sm?.userId ?? (canWarn ? await smOfStore(store).catch(() => null) : null);
  const proxies = [...checks.values()].filter((c) => c.open?.verdict === "proxy" || c.close?.verdict === "proxy").length;

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="text-xs font-bold uppercase tracking-[0.18em] text-[#ff5e79]">My Performance</p>
          <h1 className="mt-1 text-2xl font-bold sm:text-3xl">Store opening &amp; closing · {store}</h1>
        </div>
        <Link href={`/staff/performance?view=team&store=${encodeURIComponent(store)}`} className="rounded-full bg-white px-4 py-2 text-sm font-semibold ring-1 ring-black/10 hover:bg-black/5">
          ← Store dashboard
        </Link>
      </div>

      {stores.length > 1 && (
        <div className="flex flex-wrap gap-2">
          {stores.map((s) => (
            <Link
              key={s}
              href={`/staff/performance/open-close?store=${encodeURIComponent(s)}`}
              className={`rounded-full px-4 py-1.5 text-sm font-bold ${s === store ? "bg-[#8883d7] text-white" : "bg-white ring-1 ring-black/10"}`}
            >
              {s}
            </Link>
          ))}
        </div>
      )}

      {violations > 0 && (
        <p className="rounded-2xl bg-red-50 px-4 py-3 text-sm font-semibold text-red-800">
          ⚠ {violations} day(s) with an SOP violation waiting for the Director&apos;s approval.
        </p>
      )}

      {proxies > 0 && (
        <p className="rounded-2xl bg-red-50 px-4 py-3 text-sm font-semibold text-red-800">⚠ {proxies} day(s) marked as a proxy punch from the camera photos.</p>
      )}
      <div className="overflow-x-auto rounded-3xl bg-white soft-card ring-1 ring-black/5">
        <table className="w-full text-sm">
          <thead className="bg-black/[0.03] text-left text-[11px] font-bold uppercase tracking-wide text-black/50">
            <tr>
              <th className="px-3 py-2">Day</th>
              <th className="px-3 py-2">Opened</th>
              <th className="px-3 py-2">Closed</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.day} className="border-t border-black/5">
                <td className="px-3 py-2 align-top font-semibold">{formatDate(r.day)}</td>
                <Cell r={r} kind="open" canApprove={canApprove} cam={camOf(r.day, "open")} warnTo={smCode} edge={edgeOf(r.day, "open")} edgePhoto={edgePhotoOf(r.day, "open")} />
                <Cell r={r} kind="close" canApprove={canApprove} cam={camOf(r.day, "close")} warnTo={smCode} edge={edgeOf(r.day, "close")} edgePhoto={edgePhotoOf(r.day, "close")} />
              </tr>
            ))}
            {!rows.length && (
              <tr>
                <td colSpan={3} className="px-3 py-6 text-center text-black/50">
                  No openings recorded yet.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
