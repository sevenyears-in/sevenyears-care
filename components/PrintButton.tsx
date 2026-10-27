"use client";

export default function PrintButton({ label = "Download / Print" }: { label?: string }) {
  return (
    <button
      type="button"
      onClick={() => window.print()}
      className="no-print rounded-2xl bg-[#161616] px-5 py-3 text-sm font-bold text-white transition hover:opacity-90"
    >
      {label}
    </button>
  );
}
