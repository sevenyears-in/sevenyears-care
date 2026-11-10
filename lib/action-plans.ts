// Action plans from the sales trend, for each role: Store Manager, Assistant Store Manager,
// Floor Manager, CSA and CRE. Rule-based: every point comes from a number on the page.

import type { PeriodTotals, PersonReport, StoreReport, StoreTrends } from "@/lib/performance";

export type PlanRole = "sm" | "asm" | "fm" | "csa" | "cre";
export const PLAN_ROLE_LABEL: Record<PlanRole, string> = {
  sm: "Store Manager",
  asm: "Assistant Store Manager",
  fm: "Floor Manager",
  csa: "CSA",
  cre: "CRE",
};

export type PlanItem = { priority: "high" | "medium" | "good"; title: string; detail: string };

const rs = (n: number) => "₹" + Math.round(n).toLocaleString("en-IN");
const lakh = (n: number) => (Math.abs(n) >= 100000 ? `₹${(n / 100000).toFixed(2)} L` : rs(n));
const pc = (n: number, d = 0) => `${(n * 100).toFixed(d)}%`;
const WEEKDAY = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const growth = (now: number, before: number) => (before > 0 ? (now - before) / before : null);

/** Which plan a person sees on their own page. */
export function planRoleOf(role: string, roleLabel: string, group: string, asmIsFm = true): PlanRole {
  const l = roleLabel.toLowerCase();
  if (group === "sm" || role === "store_manager") return "sm";
  if (role === "floor_incharge" || /floor/.test(l)) return asmIsFm ? "asm" : "fm";
  if (group === "asm" || /assistant\s*(store)?\s*manager/.test(l)) return "asm";
  if (role === "cre" || group === "cashier_cre" || /cre\b|cashier/.test(l)) return "cre";
  return "csa";
}

type Facts = ReturnType<typeof facts>;

function facts(store: StoreReport, trends: StoreTrends, prev: PeriodTotals | null) {
  const daysLeft = Math.max(0, store.daysInMonth - store.daysGone);
  const running = daysLeft > 0;
  const perDayNow = store.daysGone ? store.net / store.daysGone : 0;
  const neededPerDay = running && store.target > store.net ? (store.target - store.net) / daysLeft : 0;
  const sellers = store.people.filter((p) => p.bills > 0 && p.group !== "none");
  const onFloor = store.people.filter((p) => ["sales", "asm", "sm"].includes(p.group));
  const abv = store.bills ? store.net / store.bills : 0;
  const upb = store.bills ? store.units / store.bills : 0;
  const l7 = trends.last7;
  const p7 = trends.prev7;
  const weekChange = growth(l7.net, p7.net);
  const abv7 = l7.bills ? l7.net / l7.bills : 0;
  const abvP7 = p7.bills ? p7.net / p7.bills : 0;
  const upb7 = l7.bills ? l7.units / l7.bills : 0;
  const upbP7 = p7.bills ? p7.units / p7.bills : 0;
  const disc7 = l7.gross ? l7.discount / l7.gross : 0;
  const discP7 = p7.gross ? p7.discount / p7.gross : 0;
  const cats = trends.categories.filter((c) => c.prev7 > 0 || c.last7 > 0);
  const rising = cats.filter((c) => c.last7 >= 2000 && (growth(c.last7, c.prev7) ?? 1) >= 0.25).sort((a, b) => b.last7 - b.prev7 - (a.last7 - a.prev7));
  const falling = cats.filter((c) => c.prev7 >= 2000 && (growth(c.last7, c.prev7) ?? 0) <= -0.25).sort((a, b) => a.last7 - a.prev7 - (b.last7 - b.prev7));
  const best = trends.weekdays[0];
  const worst = trends.weekdays.length > 2 ? trends.weekdays[trends.weekdays.length - 1] : null;
  const medianNet = [...sellers].sort((a, b) => a.net - b.net)[Math.floor(sellers.length / 2)]?.net ?? 0;
  const weak = sellers.filter((p) => p.group === "sales" && p.net < medianNet * 0.6);
  const lowUpb = sellers.filter((p) => p.bills >= 10 && p.units / p.bills < upb * 0.85).sort((a, b) => a.units / a.bills - b.units / b.bills);
  const highDisc = sellers.filter((p) => p.flaggedBills >= 5 || p.discountPct > (store.gross ? store.discount / store.gross : 0) * 1.5).sort((a, b) => b.discount - a.discount);
  const noTarget = store.people.filter((p) => p.targetApplies && p.target === null && p.group !== "none" && p.bills > 0);
  const idle = store.people.filter((p) => p.bills === 0 && p.attendance.duties > 0 && ["sales", "asm"].includes(p.group));
  const othersPct = store.invoiceNet ? store.othersNet / store.invoiceNet : 0;
  const retPct = store.invoiceNet ? store.returns / store.invoiceNet : 0;
  const topCats = trends.categories.slice(0, 3).map((c) => c.name);
  return {
    store,
    trends,
    prev,
    daysLeft,
    running,
    perDayNow,
    neededPerDay,
    sellers,
    onFloor,
    abv,
    upb,
    weekChange,
    abv7,
    abvP7,
    upb7,
    upbP7,
    disc7,
    discP7,
    rising,
    falling,
    best,
    worst,
    weak,
    lowUpb,
    highDisc,
    noTarget,
    idle,
    othersPct,
    retPct,
    topCats,
  };
}

const names = (list: { name: string }[], max = 4) => list.slice(0, max).map((p) => p.name.split(" ").slice(0, 2).join(" ")).join(", ");

function smPlan(f: Facts): PlanItem[] {
  const out: PlanItem[] = [];
  const { store } = f;
  if (f.running && store.target) {
    const perHead = f.onFloor.length ? f.neededPerDay / f.onFloor.length : 0;
    out.push(
      f.neededPerDay > f.perDayNow
        ? {
            priority: "high",
            title: `Lift daily sales from ${rs(f.perDayNow)} to ${rs(f.neededPerDay)}`,
            detail: `That is the pace for 100% in the ${f.daysLeft} days left. Give each of the ${f.onFloor.length} people on the floor a daily number of about ${rs(perHead)} and check it at 2 pm and closing.`,
          }
        : { priority: "good", title: `On pace — keep ${rs(f.perDayNow)} a day`, detail: `Hold the pace; push for the next slab instead of slowing down.` }
    );
  }
  if (f.weekChange !== null && f.weekChange <= -0.1)
    out.push({
      priority: "high",
      title: `Sales fell ${pc(-f.weekChange)} this week`,
      detail: `Last 7 days ${lakh(f.trends.last7.net)} against ${lakh(f.trends.prev7.net)} the week before. Hold a 10-minute morning huddle: yesterday's numbers, today's target, one product to push.`,
    });
  else if (f.weekChange !== null && f.weekChange >= 0.1)
    out.push({ priority: "good", title: `Sales up ${pc(f.weekChange)} this week`, detail: `Find what worked (people, products, offers) and repeat it on the slow days.` });
  if (f.best && f.worst && f.best.avg > f.worst.avg * 1.3)
    out.push({
      priority: "medium",
      title: `Plan staff by day: ${WEEKDAY[f.best.day]} is busiest, ${WEEKDAY[f.worst.day]} slowest`,
      detail: `${WEEKDAY[f.best.day]} averages ${rs(f.best.avg)} against ${rs(f.worst.avg)} on ${WEEKDAY[f.worst.day]}. Put the strongest sellers and no leaves on ${WEEKDAY[f.best.day]}; use ${WEEKDAY[f.worst.day]} for training, display changes and customer call-backs.`,
    });
  for (const c of f.falling.slice(0, 2))
    out.push({
      priority: "medium",
      title: `${c.name} dropped ${pc(-(growth(c.last7, c.prev7) ?? 0))} this week`,
      detail: `${rs(c.last7)} against ${rs(c.prev7)}. Check stock and sizes, the display and any price change; brief the team on it tomorrow.`,
    });
  if (store.flagged.length)
    out.push({
      priority: f.disc7 > f.discP7 ? "high" : "medium",
      title: `Control discounts: ${store.flagged.length} bill(s) over the limit`,
      detail: `Discount this week ${pc(f.disc7, 1)} (week before ${pc(f.discP7, 1)}). Approve every discount above the limit yourself${f.highDisc.length ? `; talk to ${names(f.highDisc, 3)}` : ""}.`,
    });
  if (f.retPct > 0.02) out.push({ priority: "medium", title: `Returns are ${pc(f.retPct, 1)} of sales`, detail: `${store.returnCount} return(s), ${lakh(store.returns)}. Check the reasons; offer exchange before refund and check size/fit at billing.` });
  if (store.othersBills)
    out.push({
      priority: f.othersPct > 0.02 ? "high" : "medium",
      title: `${store.othersBills} bill(s) without a salesperson (“Others”)`,
      detail: `${lakh(store.othersNet)} that counts for nobody. Tell the CREs: no bill without the salesperson. Check this every evening.`,
    });
  if (f.trends.uncategorized.units)
    out.push({
      priority: "medium",
      title: `${f.trends.uncategorized.units} item(s) sold have no category`,
      detail: `Ask the back office to set the category in Zoho for: ${names(f.trends.uncategorized.items, 4)}. Uncategorised items spoil WOW bills and reports.`,
    });
  if (f.noTarget.length) out.push({ priority: "medium", title: `${f.noTarget.length} person(s) have no target`, detail: `Ask the admin to set targets for ${names(f.noTarget)} — people sell better with a number.` });
  if (f.idle.length) out.push({ priority: "high", title: `On duty but no sales: ${names(f.idle)}`, detail: `Find out why (billing, stock work, training) and put them on the floor in busy hours.` });
  if (f.weak.length) out.push({ priority: "medium", title: `Coach: ${names(f.weak)}`, detail: `Below 60% of the team's middle seller. Pair each with a top seller for two busy days.` });
  return out;
}

function asmPlan(f: Facts): PlanItem[] {
  const out: PlanItem[] = [];
  if (f.running && f.neededPerDay)
    out.push({ priority: "high", title: `Run the floor for ${rs(f.neededPerDay)} a day`, detail: `Check each person's sales at noon and 5 pm; move people to the busiest section when the store is full.` });
  if (f.lowUpb.length)
    out.push({
      priority: "high",
      title: `Add-on coaching: ${names(f.lowUpb, 3)}`,
      detail: `They sell fewer items per bill than the store (${f.upb.toFixed(1)}). Practise one add-on line for every main item (e.g. ${f.topCats.slice(0, 2).join(" + ") || "matching accessories"}).`,
    });
  if (f.upbP7 && f.upb7 < f.upbP7)
    out.push({ priority: "medium", title: `Items per bill fell to ${f.upb7.toFixed(2)} this week`, detail: `From ${f.upbP7.toFixed(2)}. Keep add-on items (socks, bibs, wipes, toys under ₹500) near every billing counter.` });
  if (f.abvP7 && f.abv7 < f.abvP7 * 0.95)
    out.push({ priority: "medium", title: `Average bill fell to ${rs(f.abv7)}`, detail: `From ${rs(f.abvP7)} the week before. Show the higher-priced option first to every customer.` });
  if (f.highDisc.length) out.push({ priority: "medium", title: `Watch discounts by ${names(f.highDisc, 3)}`, detail: `Discounts above the limit need the Store Manager's OK before billing.` });
  if (f.best) out.push({ priority: "good", title: `Be on the floor all of ${WEEKDAY[f.best.day]}`, detail: `It is the busiest day (avg ${rs(f.best.avg)}); no long breaks for the team then.` });
  if (f.weak.length) out.push({ priority: "medium", title: `Buddy up ${names(f.weak, 2)}`, detail: `Let them watch a top seller close a big bill, then try the same with the next customer.` });
  return out;
}

function fmPlan(f: Facts): PlanItem[] {
  const out: PlanItem[] = [];
  for (const c of f.rising.slice(0, 2))
    out.push({ priority: "good", title: `${c.name} is rising (${rs(c.last7)} this week)`, detail: `Keep it fully stocked in all sizes and give it a front display or end-cap.` });
  for (const c of f.falling.slice(0, 2))
    out.push({ priority: "high", title: `Revive ${c.name}`, detail: `Down to ${rs(c.last7)} from ${rs(c.prev7)}. Refresh the display, check price tags and missing sizes, and move it nearer the entrance for a week.` });
  if (f.topCats.length >= 2)
    out.push({ priority: "medium", title: `Build cross-category displays`, detail: `Put ${f.topCats.slice(0, 3).join(", ")} together with small items under ₹5,000 — it helps make WOW bills (3+ categories, 4+ items).` });
  if (f.trends.uncategorized.units) out.push({ priority: "medium", title: `Uncategorised products on the floor`, detail: `${names(f.trends.uncategorized.items, 4)} have no category in Zoho — report them to the back office.` });
  if (f.store.othersBills) out.push({ priority: "medium", title: `Every bill needs a salesperson`, detail: `${f.store.othersBills} bill(s) this month have none. Tell the salesperson's name at the counter for every customer.` });
  if (f.best) out.push({ priority: "medium", title: `Floor ready before ${WEEKDAY[f.best.day]}`, detail: `Restock and tidy the busiest sections the evening before.` });
  return out;
}

function csaPlan(f: Facts, p?: PersonReport): PlanItem[] {
  const out: PlanItem[] = [];
  if (p && p.target && f.running) {
    const need = Math.max(0, p.target - p.net) / Math.max(1, f.daysLeft);
    out.push({ priority: "high", title: `Your daily number: ${rs(need)}`, detail: `To reach 100% of your target (${rs(p.target)}) in the ${f.daysLeft} day(s) left. Now at ${pc(p.achievement ?? 0)}.` });
  }
  if (p && p.bills >= 5) {
    const myUpb = p.units / p.bills;
    if (myUpb < f.upb)
      out.push({ priority: "high", title: `Add one more item to every bill`, detail: `You sell ${myUpb.toFixed(1)} items per bill; the store sells ${f.upb.toFixed(1)}. Suggest ${f.rising[0]?.name ?? f.topCats[0] ?? "a matching item"} or small items under ₹500 with every main item.` });
    if (p.abv < f.abv)
      out.push({ priority: "medium", title: `Lift your average bill from ${rs(p.abv)}`, detail: `The store average is ${rs(f.abv)}. Show the better option first, then the cheaper one.` });
    if (p.flaggedBills) out.push({ priority: "medium", title: `${p.flaggedBills} of your bills had high discount`, detail: `Every ₹100 discount is ₹100 less in your sales. Ask the Store Manager before giving more than the limit.` });
    if (p.returns > 0) out.push({ priority: "medium", title: `Returns took ${rs(p.returns)} from your sales`, detail: `Check size, fit and age suitability with the customer before billing.` });
  } else {
    out.push({ priority: "medium", title: `Add one more item to every bill`, detail: `The store sells ${f.upb.toFixed(1)} items per bill. Suggest a matching small item with every main item.` });
  }
  if (f.rising[0]) out.push({ priority: "good", title: `Customers are buying ${f.rising[0].name}`, detail: `Up this week (${rs(f.rising[0].last7)}). Show it to every family with a child of the right age.` });
  out.push({ priority: "medium", title: `Aim for WOW bills`, detail: `₹10,000+ with 4+ items from 3+ categories (3 items under ₹5,000). Combine ${f.topCats.slice(0, 3).join(", ") || "different categories"}.` });
  if (f.best) out.push({ priority: "good", title: `${WEEKDAY[f.best.day]} is the busiest day`, detail: `Be on time and on the floor; it is the easiest day to meet your number.` });
  return out;
}

function crePlan(f: Facts, p?: PersonReport): PlanItem[] {
  const out: PlanItem[] = [];
  if (f.store.othersBills)
    out.push({
      priority: "high",
      title: `No bill without the salesperson`,
      detail: `${f.store.othersBills} bill(s) (${lakh(f.store.othersNet)}) went out without one this month — that sale counts for nobody. Ask "who helped you?" before billing.`,
    });
  if (f.store.flagged.length) out.push({ priority: "high", title: `Check discounts at billing`, detail: `${f.store.flagged.length} bill(s) went above the discount limit. Bill above the limit only with the Store Manager's OK.` });
  if (f.retPct > 0.01) out.push({ priority: "medium", title: `Returns: offer exchange first`, detail: `Returns are ${pc(f.retPct, 1)} of sales. Note the reason for every return and tell the Store Manager.` });
  out.push({ priority: "medium", title: `Last add-on at the counter`, detail: `Keep small items near billing and offer one with every bill — it lifts items per bill for the whole store (now ${f.upb.toFixed(1)}).` });
  out.push({ priority: "medium", title: `Register every warranty and ask for feedback`, detail: `Help the customer register the warranty in the Seven Years Care app and ask them to rate the visit.` });
  if (p && p.bills >= 5 && p.abv < f.abv) out.push({ priority: "medium", title: `Your average bill is ${rs(p.abv)}`, detail: `Store average ${rs(f.abv)}. Suggest one more item to customers you bill yourself.` });
  return out;
}

/** Plans for each role. While ASM and Floor Manager are one role, their points come as one list. */
export function actionPlans(store: StoreReport, trends: StoreTrends, prev: PeriodTotals | null, asmIsFm = true) {
  const f = facts(store, trends, prev);
  const asm = asmPlan(f);
  const fm = fmPlan(f);
  const both = [...asm, ...fm.filter((x) => !asm.some((a) => a.title === x.title))];
  const out: { role: PlanRole; label: string; items: PlanItem[] }[] = [{ role: "sm", label: PLAN_ROLE_LABEL.sm, items: smPlan(f) }];
  if (asmIsFm) out.push({ role: "asm", label: "ASM / Floor Manager", items: both });
  else out.push({ role: "asm", label: PLAN_ROLE_LABEL.asm, items: asm }, { role: "fm", label: PLAN_ROLE_LABEL.fm, items: fm });
  out.push({ role: "csa", label: PLAN_ROLE_LABEL.csa, items: csaPlan(f) }, { role: "cre", label: PLAN_ROLE_LABEL.cre, items: crePlan(f) });
  return out;
}

/** One person's own plan (their role, with their own numbers). */
export function personalPlan(role: PlanRole, store: StoreReport, trends: StoreTrends, p: PersonReport, asmIsFm = true) {
  const f = facts(store, trends, null);
  switch (role) {
    case "sm":
      return smPlan(f);
    case "asm": {
      if (!asmIsFm) return asmPlan(f);
      const asm = asmPlan(f);
      return [...asm, ...fmPlan(f).filter((x) => !asm.some((a) => a.title === x.title))];
    }
    case "fm":
      return [...fmPlan(f), ...csaPlan(f, p).slice(0, 2)];
    case "cre":
      return crePlan(f, p);
    default:
      return csaPlan(f, p);
  }
}
