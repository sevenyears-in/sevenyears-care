// Staff app manifest (the customer app uses app/manifest.ts).

export const dynamic = "force-static";

export function GET() {
  const manifest = {
    name: "Seven Years Care — Staff",
    short_name: "SY Staff",
    description: "Warranty, service requests and complaints for Seven Years staff.",
    id: "/staff",
    start_url: "/staff",
    scope: "/staff",
    display: "standalone",
    orientation: "portrait",
    background_color: "#f7f9fb",
    theme_color: "#8883d7",
    icons: [
      { src: "/app-icon-round-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/app-icon-round-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
      { src: "/app-icon-maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
  };
  return new Response(JSON.stringify(manifest), {
    headers: { "Content-Type": "application/manifest+json", "Cache-Control": "public, max-age=3600" },
  });
}
