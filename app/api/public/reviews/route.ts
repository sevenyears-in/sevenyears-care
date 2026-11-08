import { NextResponse } from "next/server";
import { publishedReviews } from "@/lib/reviews";

// GET /api/public/reviews?limit=12 — published customer review summaries for sevenyears.in.
// Only name (if the customer gave one), store, date, overall stars and the summary. No phone numbers.
const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
  "Cache-Control": "public, max-age=120, s-maxage=300",
};

export async function GET(request: Request) {
  const limit = Number(new URL(request.url).searchParams.get("limit") ?? 12) || 12;
  const reviews = await publishedReviews(limit);
  return NextResponse.json({ reviews }, { headers: CORS });
}

export function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: CORS });
}
