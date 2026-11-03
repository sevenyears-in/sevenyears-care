// Customer app manifest (installs Seven Years Care from care.sevenyears.in).
// Staff pages link their own manifest (/staff-app.webmanifest) so both apps install separately.

export const dynamic = "force-static";

export function GET() {
  const manifest = {
    name: "Seven Years Care",
    short_name: "SY Care",
    description: "Your Seven Years warranties, service requests, complaints and feedback in one place.",
    id: "/",
    start_url: "/?source=app",
    scope: "/",
    display: "standalone",
    orientation: "portrait",
    background_color: "#f7f9fb",
    theme_color: "#8883d7",
    icons: [
      { src: "/app-icon-round-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/app-icon-round-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
      { src: "/app-icon-maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
    shortcuts: [
      { name: "Request Service", url: "/request-service", icons: [{ src: "/app-icon-192.png", sizes: "192x192" }] },
      { name: "Track Request", url: "/track-request", icons: [{ src: "/app-icon-192.png", sizes: "192x192" }] },
      { name: "My Account", url: "/account", icons: [{ src: "/app-icon-192.png", sizes: "192x192" }] },
    ],
  };
  return new Response(JSON.stringify(manifest), {
    headers: { "Content-Type": "application/manifest+json", "Cache-Control": "public, max-age=3600" },
  });
}
