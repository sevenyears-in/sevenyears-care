import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/server";
import { requireStaff } from "@/lib/auth";

// Zoho POS categories whose items get a warranty.
// GET (any staff) → list
// POST / PATCH / DELETE (admin) → manage

export async function GET() {
  const auth = await requireStaff();
  if (auth.response) return auth.response;

  const { data, error } = await supabaseAdmin
    .from("warranty_categories")
    .select("id, category_name, standard_months, extended_allowed, is_active")
    .order("category_name");

  if (error) {
    console.error("List categories error:", error);
    return NextResponse.json({ error: "Unable to load categories." }, { status: 500 });
  }

  return NextResponse.json({ categories: data ?? [] });
}

function parseMonths(value: unknown) {
  const months = Number(value);
  return Number.isInteger(months) && months >= 1 && months <= 120 ? months : null;
}

export async function POST(request: Request) {
  const auth = await requireStaff("admin");
  if (auth.response) return auth.response;

  try {
    const body = await request.json();
    const categoryName = String(body.categoryName ?? "").trim();
    const months = parseMonths(body.standardMonths ?? 6);

    if (!categoryName) {
      return NextResponse.json(
        { error: "Enter the category name exactly as it appears in Zoho POS." },
        { status: 400 }
      );
    }
    if (!months) {
      return NextResponse.json(
        { error: "Warranty months must be between 1 and 120." },
        { status: 400 }
      );
    }

    const { error } = await supabaseAdmin.from("warranty_categories").insert({
      category_name: categoryName,
      standard_months: months,
      extended_allowed: body.extendedAllowed !== false,
    });

    if (error) {
      if (error.code === "23505") {
        return NextResponse.json({ error: "This category is already in the list." }, { status: 409 });
      }
      throw error;
    }

    return NextResponse.json({ success: true }, { status: 201 });
  } catch (error) {
    console.error("Add category error:", error);
    return NextResponse.json({ error: "Unable to add the category." }, { status: 500 });
  }
}

export async function PATCH(request: Request) {
  const auth = await requireStaff("admin");
  if (auth.response) return auth.response;

  try {
    const body = await request.json();
    const id = String(body.id ?? "");
    const update: Record<string, unknown> = {};

    if (body.standardMonths !== undefined) {
      const months = parseMonths(body.standardMonths);
      if (!months) {
        return NextResponse.json(
          { error: "Warranty months must be between 1 and 120." },
          { status: 400 }
        );
      }
      update.standard_months = months;
    }
    if (typeof body.extendedAllowed === "boolean") update.extended_allowed = body.extendedAllowed;
    if (typeof body.isActive === "boolean") update.is_active = body.isActive;

    if (!id || Object.keys(update).length === 0) {
      return NextResponse.json({ error: "Nothing to update." }, { status: 400 });
    }

    const { error } = await supabaseAdmin.from("warranty_categories").update(update).eq("id", id);
    if (error) throw error;

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Update category error:", error);
    return NextResponse.json({ error: "Unable to update the category." }, { status: 500 });
  }
}

export async function DELETE(request: Request) {
  const auth = await requireStaff("admin");
  if (auth.response) return auth.response;

  const id = new URL(request.url).searchParams.get("id");
  if (!id) return NextResponse.json({ error: "Missing category id." }, { status: 400 });

  const { error } = await supabaseAdmin.from("warranty_categories").delete().eq("id", id);
  if (error) {
    console.error("Delete category error:", error);
    return NextResponse.json({ error: "Unable to remove the category." }, { status: 500 });
  }

  return NextResponse.json({ success: true });
}
