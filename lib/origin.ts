// The public address of the site (e.g. https://care.sevenyears.in).
// Behind a hosting proxy, request.url can show an internal address such as
// https://0.0.0.0:3000, so prefer NEXT_PUBLIC_SITE_URL, then the forwarded
// host headers, and only then the request URL.

export function publicOrigin(request: Request) {
  const configured = process.env.NEXT_PUBLIC_SITE_URL?.trim().replace(/\/$/, "");
  if (configured && /^https?:\/\//.test(configured)) return configured;

  const headers = request.headers;
  const host = (headers.get("x-forwarded-host") ?? headers.get("host"))?.split(",")[0].trim();
  if (host && !host.startsWith("0.0.0.0")) {
    const proto =
      headers.get("x-forwarded-proto")?.split(",")[0].trim() ||
      (host.startsWith("localhost") || host.startsWith("127.0.0.1") ? "http" : "https");
    return `${proto}://${host}`;
  }

  return new URL(request.url).origin;
}
