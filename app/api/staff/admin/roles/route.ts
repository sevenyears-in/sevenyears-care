import { NextResponse } from "next/server";
import { requireStaff } from "@/lib/auth";
import { supabaseAdmin } from "@/lib/supabase/server";
import { ASSIGNABLE_ROLES } from "@/lib/roles";
import { defaultAccess, type AccessConfig } from "@/lib/access";
import { cleanAccessConfig, loadAccessConfig, saveAccessConfig } from "@/lib/access-config";

// Roles & Access (Super Admin only).
// GET → { config, defaults, usage }   PUT { config } → save

async function usage() {
  const { data } = await supabaseAdmin.from("staff_users").select("role, custom_role_id").eq("is_active", true);
  const byRole: Record<string, number> = {};
  for (const r of (data ?? []) as { role: string; custom_role_id?: string | null }[]) {
    const key = r.custom_role_id ? `custom:${r.custom_role_id}` : r.role;
    byRole[key] = (byRole[key] ?? 0) + 1;
  }
  return byRole;
}

export async function GET() {
  const auth = await requireStaff("super_admin");
  if (auth.response) return auth.response;
  const [config, counts] = await Promise.all([loadAccessConfig(), usage()]);
  const defaults = Object.fromEntries(ASSIGNABLE_ROLES.filter((r) => r !== "super_admin").map((r) => [r, defaultAccess(r)]));
  return NextResponse.json({ config, defaults, usage: counts });
}

export async function PUT(request: Request) {
  const auth = await requireStaff("super_admin");
  if (auth.response) return auth.response;
  try {
    const body = (await request.json().catch(() => ({}))) as { config?: AccessConfig };
    const next = cleanAccessConfig(body.config);
    const names = next.custom.map((c) => c.name.toLowerCase());
    if (new Set(names).size !== names.length) return NextResponse.json({ error: "Two custom roles have the same name." }, { status: 400 });

    // A custom role still given to someone can't be removed.
    const before = await loadAccessConfig();
    const removed = before.custom.filter((c) => !next.custom.some((n) => n.id === c.id));
    if (removed.length) {
      const { data } = await supabaseAdmin.from("staff_users").select("full_name, custom_role_id").in("custom_role_id", removed.map((c) => c.id));
      if (data && data.length) {
        const role = removed.find((c) => c.id === data[0].custom_role_id)?.name ?? "this role";
        return NextResponse.json(
          { error: `"${role}" is still given to ${data.map((d) => d.full_name).join(", ")}. Change their role first.` },
          { status: 409 }
        );
      }
    }
    // Changing "works like" moves the people with that role to the new built-in role.
    for (const c of next.custom) {
      const old = before.custom.find((o) => o.id === c.id);
      if (old && old.baseRole !== c.baseRole) {
        await supabaseAdmin.from("staff_users").update({ role: c.baseRole }).eq("custom_role_id", c.id);
      }
    }
    const saved = await saveAccessConfig(next);
    return NextResponse.json({ success: true, config: saved });
  } catch (error) {
    console.error("Save roles error:", error);
    return NextResponse.json({ error: "Unable to save. Please try again." }, { status: 500 });
  }
}
