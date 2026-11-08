"use client";

import type { FamilyDates } from "@/lib/family-types";

const MAX = 6;
const input =
  "w-full rounded-2xl border border-black/10 bg-white px-4 py-3 text-sm outline-none focus:border-[#8883d7] focus:ring-2 focus:ring-[#8883d7]/20";
const label = "mb-1.5 block text-xs font-bold text-black/60";

/** Children's birthdays, parents' birthdays and wedding anniversary (all optional). */
export function FamilyDatesFields({ value, onChange }: { value: FamilyDates; onChange: (v: FamilyDates) => void }) {
  const kids = value.children.length ? value.children : [{ name: "", dob: "" }];
  const setKid = (i: number, key: "name" | "dob", v: string) =>
    onChange({ ...value, children: kids.map((k, j) => (j === i ? { ...k, [key]: v } : k)) });
  const removeKid = (i: number) => onChange({ ...value, children: kids.filter((_, j) => j !== i) });

  return (
    <div className="space-y-4">
      <div className="space-y-3">
        {kids.map((k, i) => (
          <div key={i} className="grid gap-3 sm:grid-cols-[1fr_1fr_auto] sm:items-end">
            <label className="block">
              <span className={label}>👶 Child {kids.length > 1 ? i + 1 : ""} name</span>
              <input value={k.name} onChange={(e) => setKid(i, "name", e.target.value)} className={input} placeholder="Optional" />
            </label>
            <label className="block">
              <span className={label}>🎂 Birthday</span>
              <input type="date" value={k.dob} onChange={(e) => setKid(i, "dob", e.target.value)} className={input} />
            </label>
            {kids.length > 1 ? (
              <button type="button" onClick={() => removeKid(i)} className="rounded-2xl px-3 py-3 text-xs font-bold text-black/45 hover:text-[#ff5e79]">
                Remove
              </button>
            ) : (
              <span className="hidden sm:block" />
            )}
          </div>
        ))}
        {kids.length < MAX && (
          <button
            type="button"
            onClick={() => onChange({ ...value, children: [...kids, { name: "", dob: "" }] })}
            className="text-xs font-bold text-[#0b7f90] hover:underline"
          >
            + Add another child
          </button>
        )}
      </div>
      <div className="grid gap-3 sm:grid-cols-3">
        <label className="block">
          <span className={label}>👨 Father&apos;s birthday</span>
          <input type="date" value={value.fatherDob} onChange={(e) => onChange({ ...value, fatherDob: e.target.value })} className={input} />
        </label>
        <label className="block">
          <span className={label}>👩 Mother&apos;s birthday</span>
          <input type="date" value={value.motherDob} onChange={(e) => onChange({ ...value, motherDob: e.target.value })} className={input} />
        </label>
        <label className="block">
          <span className={label}>💍 Wedding anniversary</span>
          <input type="date" value={value.anniversary} onChange={(e) => onChange({ ...value, anniversary: e.target.value })} className={input} />
        </label>
      </div>
    </div>
  );
}
