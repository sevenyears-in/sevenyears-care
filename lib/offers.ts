import { supabaseAdmin } from "@/lib/supabase/server";
import { todayISO } from "@/lib/helpers";

export type Offer = {
  id: string;
  title: string;
  message: string;
  link: string | null;
  valid_until: string | null;
  created_by: string;
  created_at: string;
  sent_at: string | null;
  send_error: string | null;
  is_active: boolean;
  audience?: "all" | "selected";
  target_mobiles?: string[];
};

/** Offers a customer can see now: for everyone, plus ones sent to their own mobile. */
export async function currentOffers(mobile?: string | null): Promise<Offer[]> {
  const { data, error } = await supabaseAdmin
    .from("offers")
    .select("*")
    .eq("is_active", true)
    .or(`valid_until.is.null,valid_until.gte.${todayISO()}`)
    .order("created_at", { ascending: false })
    .limit(30);
  if (error) return [];
  return ((data ?? []) as Offer[]).filter(
    (o) => (o.audience ?? "all") === "all" || (!!mobile && (o.target_mobiles ?? []).includes(mobile))
  );
}
