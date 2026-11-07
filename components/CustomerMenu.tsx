"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { afterLogout } from "@/lib/in-app";

// Top-right of the customer site: "My Account" link, or the logged-in name with a Log out button.
export function CustomerMenu() {
  const [name, setName] = useState<string | null>(null);
  const [loggedIn, setLoggedIn] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    const load = async () => {
      const response = await fetch("/api/account/me", { cache: "no-store" }).catch(() => null);
      const data = response ? await response.json().catch(() => null) : null;
      if (data?.loggedIn) {
        setLoggedIn(true);
        setName(String(data.name || "").split(" ")[0] || null);
      }
    };
    load();
  }, []);

  if (!loggedIn) {
    return (
      <Link
        href="/account"
        className="rounded-full bg-[#161616] px-5 py-2.5 text-sm font-semibold text-white transition hover:bg-[#ff5e79]"
      >
        My Account
      </Link>
    );
  }

  return (
    <div className="flex items-center gap-2">
      <Link
        href="/account"
        className="rounded-full bg-[#161616] px-4 py-2 text-sm font-semibold text-white"
      >
        {name ? `Hi, ${name}` : "My Account"}
      </Link>
      <button
        type="button"
        disabled={busy}
        onClick={async () => {
          setBusy(true);
          await fetch("/api/account/logout", { method: "POST" }).catch(() => null);
          window.location.assign(afterLogout("/"));
        }}
        className="rounded-full border border-black/10 bg-white px-4 py-2 text-sm font-semibold text-black/60 transition hover:bg-black hover:text-white disabled:opacity-50"
      >
        {busy ? "..." : "Log out"}
      </button>
    </div>
  );
}
