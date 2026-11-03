import type { MetadataRoute } from "next";

// Customer app: install Seven Years Care from care.sevenyears.in (Android, iPhone, desktop).
// The staff app has its own manifest (/staff-app.webmanifest) so both can be installed separately.
export default function manifest(): MetadataRoute.Manifest {
  return {
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
}
