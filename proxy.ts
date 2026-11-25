import { NextResponse, type NextRequest } from "next/server";

// Keeps the site on HTTPS. The CCTV recorders (VIGI NVRs) can only send their alarm photos over plain
// HTTP, so /api/cctv/ is the one path that may be reached without HTTPS. Only redirects when the
// hosting says the request came over plain HTTP (x-forwarded-proto: http) — never on a guess.
export function proxy(request: NextRequest) {
  const proto = request.headers.get("x-forwarded-proto")?.split(",")[0]?.trim().toLowerCase();
  if (proto !== "http") return NextResponse.next();
  if (request.nextUrl.pathname.startsWith("/api/cctv/")) return NextResponse.next();
  const host = request.headers.get("x-forwarded-host") ?? request.headers.get("host");
  if (!host) return NextResponse.next();
  return NextResponse.redirect(`https://${host}${request.nextUrl.pathname}${request.nextUrl.search}`, 308);
}

// Pages and API calls only: files (images, icons, …) and Next's own paths are left alone, so the
// image optimiser's internal requests for /logo.png etc. are never redirected.
export const config = {
  matcher: ["/((?!_next/|favicon.ico|.*\\.[a-zA-Z0-9]+$).*)"],
};
